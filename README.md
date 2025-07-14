# oreno-ai-code-review-action

`.github/workflows/ai-review.yml`

```
name: PR AI Review
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
  issues: write
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run AI Code Review
        uses: ucan-lab/oreno-ai-code-review-action@v0
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  re_review:
    if: github.event.issue.pull_request && contains(github.event.comment.body, '/re-review')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run AI Code Review
        uses: ucan-lab/oreno-ai-code-review-action@v0
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
