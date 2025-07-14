"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const openaiKey = core.getInput('openai_api_key');
        const token = process.env.GITHUB_TOKEN;
        if (!token)
            throw new Error('GITHUB_TOKENが設定されていません');
        const repo = github.context.repo;
        let prNumber;
        if (github.context.payload.pull_request) {
            prNumber = github.context.payload.pull_request.number;
        }
        else if (github.context.payload.issue &&
            github.context.payload.issue.pull_request &&
            typeof github.context.payload.issue.number === 'number') {
            prNumber = github.context.payload.issue.number;
        }
        if (!prNumber)
            throw new Error('プルリクエスト番号が取得できません');
        const diff = (0, child_process_1.execSync)(`gh pr diff ${prNumber} --repo ${repo.owner}/${repo.repo} --color never`).toString();
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
        }
        else {
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
        (0, axios_retry_1.default)(axios_1.default, {
            retries: 5,
            retryCondition: (error) => {
                return !!(error.response && error.response.status === 429);
            },
            retryDelay: (retryCount, error) => {
                const retryAfter = error.response && error.response.headers['retry-after'];
                if (retryAfter) {
                    const delay = Number(retryAfter);
                    if (!isNaN(delay)) {
                        return delay * 1000;
                    }
                    else {
                        const date = new Date(retryAfter);
                        const now = new Date();
                        return Math.max(date.getTime() - now.getTime(), 1000);
                    }
                }
                return axios_retry_1.default.exponentialDelay(retryCount);
            },
        });
        const res = yield axios_1.default.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
        }, {
            headers: {
                Authorization: `Bearer ${openaiKey}`,
                'Content-Type': 'application/json',
            },
        });
        const review = res.data.choices[0].message.content;
        const octokit = github.getOctokit(token);
        yield octokit.rest.issues.createComment({
            owner: repo.owner,
            repo: repo.repo,
            issue_number: prNumber,
            body: `💬 **AI Review Bot** says:\n\n${review}`,
        });
        console.log('レビュー投稿完了');
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err)) {
            core.error(`Axiosエラー: ${err.message}`);
            if (err.response) {
                core.error(`status: ${err.response.status}`);
                core.error(`statusText: ${err.response.statusText}`);
                core.error(`response data: ${JSON.stringify(err.response.data)}`);
                core.error(`response headers: ${JSON.stringify(err.response.headers)}`);
            }
            core.error(`config: ${JSON.stringify(err.config)}`);
            core.error(`stack: ${err.stack}`);
        }
        else {
            core.error(`一般エラー: ${err.message}`);
            core.error(`stack: ${err.stack}`);
        }
        core.setFailed(`エラー: ${err.message}`);
    }
}))();
