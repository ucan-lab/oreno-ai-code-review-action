const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const exec = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const openaiKey = core.getInput('openai_api_key');
    const token = process.env.GITHUB_TOKEN;
    const repo = github.context.repo;
    let prNumber;

    if (github.context.payload.pull_request) {
      prNumber = github.context.payload.pull_request.number;
    } else if (github.context.payload.issue && github.context.payload.issue.pull_request) {
      prNumber = github.context.payload.issue.number;
    }

    if (!prNumber) throw new Error('プルリクエスト番号が取得できません');

    const diff = exec(`gh pr diff ${prNumber} --repo ${repo.owner}/${repo.repo} --color never`).toString();

    // プロンプトファイルの読み込み
    const promptFile = core.getInput('prompt_file');
    let reviewPrompt;
    if (promptFile) {
      const promptPath = path.resolve(promptFile);
      console.info(`指定されたプロンプトファイル: ${promptPath}`);
      if (!fs.existsSync(promptPath)) {
        throw new Error(`指定されたプロンプトファイルが存在しません: ${promptPath}`);
      }
      reviewPrompt = fs.readFileSync(promptPath, 'utf8');
    } else {
      const defaultPromptPath = path.resolve('default_prompt.md');
      console.info(`デフォルトプロンプトファイル: ${defaultPromptPath}`);
      if (!fs.existsSync(defaultPromptPath)) {
        throw new Error(`デフォルトプロンプトファイルが存在しません: ${defaultPromptPath}`);
      }
      reviewPrompt = fs.readFileSync(defaultPromptPath, 'utf8');
    }

    const prompt = `
${reviewPrompt}

--- Diff Start ---
${diff.slice(0, 3500)}
--- Diff End ---
`;

    axiosRetry(axios, {
      retries: 5,
      retryCondition: (error) => {
        return error.response && error.response.status === 429;
      },
      retryDelay: (retryCount, error) => {
        const retryAfter = error.response && error.response.headers['retry-after'];
        if (retryAfter) {
          // retry-afterが秒数の場合と日付の場合がある
          const delay = Number(retryAfter);
          if (!isNaN(delay)) {
            return delay * 1000;
          } else {
            const date = new Date(retryAfter);
            const now = new Date();
            return Math.max(date.getTime() - now.getTime(), 1000);
          }
        }
        // デフォルトは指数バックオフ
        return axiosRetry.exponentialDelay(retryCount);
      },
    });

    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const review = res.data.choices[0].message.content;

    const octokit = github.getOctokit(token);
    await octokit.rest.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      body: `💬 **AI Review Bot** says:\n\n${review}`,
    });

    console.log('レビュー投稿完了');
  } catch (err) {
    if (err.isAxiosError) {
      core.error(`Axiosエラー: ${err.message}`);
      if (err.response) {
        core.error(`status: ${err.response.status}`);
        core.error(`statusText: ${err.response.statusText}`);
        core.error(`response data: ${JSON.stringify(err.response.data)}`);
        core.error(`response headers: ${JSON.stringify(err.response.headers)}`);
      }
      core.error(`config: ${JSON.stringify(err.config)}`);
      core.error(`stack: ${err.stack}`);
    } else {
      core.error(`一般エラー: ${err.message}`);
      core.error(`stack: ${err.stack}`);
    }
    core.setFailed(`エラー: ${err.message}`);
  }
})();
