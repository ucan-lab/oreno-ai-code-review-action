const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const exec = require('child_process').execSync;

(async () => {
  try {
    const openaiKey = core.getInput('openai_api_key');
    const token = process.env.GITHUB_TOKEN;
    const repo = github.context.repo;
    const prNumber = github.context.payload.pull_request.number;

    const diff = exec(`gh pr diff ${prNumber} --repo ${repo.owner}/${repo.repo} --color never`).toString();

    const prompt = `
次のコードの差分についてレビューしてください。バグ、改善点、可読性に関して指摘してください。

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
    core.setFailed(`エラー: ${err.message}`);
  }
})();
