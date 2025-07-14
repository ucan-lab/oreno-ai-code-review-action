import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function getPrNumber(context: typeof github.context): number {
  console.info(context.payload);

  if (context.payload.pull_request) {
    return context.payload.pull_request.number;
  } else if (
    context.payload.issue &&
    context.payload.issue.pull_request &&
    typeof context.payload.issue.number === 'number'
  ) {
    return context.payload.issue.number;
  }
  throw new Error('プルリクエスト番号が取得できません');
}

function getIgnorePatterns(ignoreFilePath: string = '.aicodereviewignore'): string[] {
  const absPath = path.resolve(ignoreFilePath);
  if (!fs.existsSync(absPath)) return [];
  return fs
    .readFileSync(absPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function getDiff(prNumber: number, repo: { owner: string; repo: string }): string {
  const ignorePatterns = getIgnorePatterns();
  const excludeArgs = ignorePatterns.map((pattern) => `--exclude ${pattern}`).join(' ');
  return execSync(
    `gh pr diff ${prNumber} --repo ${repo.owner}/${repo.repo} --color never ${excludeArgs}`,
    { maxBuffer: 10 * 1024 * 1024 },
  ).toString();
}

function getReviewPrompt(promptFile: string | undefined): string {
  if (promptFile) {
    const promptPath = path.resolve(promptFile);
    console.info(`指定されたプロンプトファイル: ${promptPath}`);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`指定されたプロンプトファイルが存在しません: ${promptPath}`);
    }
    return fs.readFileSync(promptPath, 'utf8');
  } else {
    const defaultPromptPath = path.resolve('default_prompt.md');
    console.info(`デフォルトプロンプトファイル: ${defaultPromptPath}`);
    if (!fs.existsSync(defaultPromptPath)) {
      throw new Error(`デフォルトプロンプトファイルが存在しません: ${defaultPromptPath}`);
    }
    return fs.readFileSync(defaultPromptPath, 'utf8');
  }
}

function createOpenAIPrompt(reviewPrompt: string, diff: string): string {
  return `\n${reviewPrompt}\n\n--- Diff Start ---\n${diff.slice(0, 3500)}\n--- Diff End ---\n`;
}

function setupAxiosRetry() {
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
}

async function requestOpenAIReview(openaiKey: string, prompt: string): Promise<string> {
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
  return res.data.choices[0].message.content;
}

async function postReviewComment(
  token: string,
  repo: { owner: string; repo: string },
  prNumber: number,
  review: string,
) {
  const octokit = github.getOctokit(token);
  await octokit.rest.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: prNumber,
    body: `💬 **AI Review Bot** says:\n\n${review}`,
  });
}

function handleError(err: unknown) {
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
  } else if (err instanceof Error) {
    core.error(`一般エラー: ${err.message}`);
    core.error(`stack: ${err.stack}`);
  } else {
    core.error(`未知のエラー: ${JSON.stringify(err)}`);
  }
  core.setFailed(`エラー: ${err instanceof Error ? err.message : String(err)}`);
}

async function main() {
  try {
    const openaiKey: string = core.getInput('openai_api_key');
    if (!openaiKey) throw new Error('OpenAI APIキーが設定されていません');
    const token: string | undefined = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKENが設定されていません');
    const repo = github.context.repo;
    const prNumber = getPrNumber(github.context);
    const diff = getDiff(prNumber, repo);
    const promptFile: string = core.getInput('prompt_file');
    const reviewPrompt = getReviewPrompt(promptFile);
    const prompt = createOpenAIPrompt(reviewPrompt, diff);
    setupAxiosRetry();
    const review = await requestOpenAIReview(openaiKey, prompt);
    await postReviewComment(token, repo, prNumber, review);
    console.log('レビュー投稿完了');
  } catch (err: unknown) {
    handleError(err);
  }
}

main();
