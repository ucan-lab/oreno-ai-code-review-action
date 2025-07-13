const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
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
