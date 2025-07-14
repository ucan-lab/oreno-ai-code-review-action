import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  try {
    const openaiKey: string = core.getInput('openai_api_key');
    const token: string | undefined = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKENが設定されていません');
    const repo = github.context.repo;
    let prNumber;

    if (github.context.payload.pull_request) {
      prNumber = github.context.payload.pull_request.number;
    } else if (
      github.context.payload.issue &&
      github.context.payload.issue.pull_request &&
      typeof github.context.payload.issue.number === 'number'
    ) {
      prNumber = github.context.payload.issue.number;
    }

    if (!prNumber) throw new Error('プルリクエスト番号が取得できません');

    const diff: string = execSync(
      `gh pr diff ${prNumber} --repo ${repo.owner}/${repo.repo} --color never`,
    ).toString();

    // プロンプトファイルの読み込み
    const promptFile: string = core.getInput('prompt_file');
    let reviewPrompt: string;
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
      retryCondition: (error: AxiosError) => {
        return !!(error.response && error.response.status === 429);
      },
      retryDelay: (retryCount, error: AxiosError) => {
        const retryAfter = error.response && error.response.headers['retry-after'];
        if (retryAfter) {
          const delay = Number(retryAfter);
          if (!isNaN(delay)) {
            return delay * 1000;
          } else {
            const date = new Date(retryAfter);
            const now = new Date();
            return Math.max(date.getTime() - now.getTime(), 1000);
          }
        }
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
      },
    );

    const review: string = res.data.choices[0].message.content;

    const octokit = github.getOctokit(token);
    await octokit.rest.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      body: `💬 **AI Review Bot** says:\n\n${review}`,
    });

    console.log('レビュー投稿完了');
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
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
