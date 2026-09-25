import { Octokit } from "@octokit/rest";

const SKIP_DIRS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    "vendor",
    "target",
    "__pycache__",
    ".gradle"
];

const SKIP_EXTENSIONS = [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "svg",
    "ico",
    "webp",
    "woff",
    "woff2",
    "ttf",
    "eot",
    "otf",
    "mp3",
    "mp4",
    "mov",
    "wav",
    "wab",
    "webm",
    "zip",
    "rar",
    "7z",
    "tar",
    "gz"

];

const SKIP_FILES = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".env",
    ".env.local",
    ".env.development",
    ".env.test",
    ".env.production"
];

function shouldSkipFile(path, size) {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1];

    if(parts.some(part => SKIP_DIRS.includes(part))) {
        return true;
    }
    
    if(SKIP_FILES.includes(fileName)) {
        return true;
    }
    if(typeof size === "number" && size > 200_00) return true;
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
    if(SKIP_EXTENSIONS.includes(ext)) {
        return true;
    }
    if(fileName.startsWith(".")) {
        return true;
    }
    return false;
}

export function parseRepo(input){
    const clean = input.replace("https://github.com/", "").replace("http://github.com/", "").replace(/\.git$/, "");
    const [owner, repo] = clean.split("/");
    return { owner, repo, repoKey: `${owner}/${repo}` };
}

export async function fetchRepoFiles(token, owner, repo) {
    // Initialize Octokit instance with the provided token
    const octokit = new Octokit({ auth: token });

    //fetch the repository files
    const {data:repoInfo} = await octokit.rest.repos.get({
        owner,
        repo
    }).catch(err => {
        if(err.status === 404) {
            throw new Error(`GitHub could not find the ${owner}/${repo}. Find-grained tokens (github_pat_) must include this repository.`);
        } 
        throw err;
    });
    // fetch the repository tree
    const {data:repoTree} = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: repoInfo.default_branch,
        recursive: "true"
    }).catch(err => {
        console.error("Failed to fetch repository tree:", err);
        throw err;
    });
    const files = [];
    // iterate through the repository tree and process files
    for(const item of repoTree.tree) {
        if(item.type !== "blob") continue;
        if(shouldSkipFile(item.path, item.size)) continue;

        const {data:blob} = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: item.sha
        }).catch(err => {
            console.error(`Failed to fetch blob for ${item.path}:`, err);
            throw err;
        });
        // add the file to the list of processed files
        files.push({
            path: item.path,
            size: item.size,
            sha: item.sha,
            content: Buffer.from(blob.content, "base64").toString("utf-8"),
            encoding: blob.encoding
        });

        if(files.length >= 1000) break; // stop processing if we have reached 1000 files
    }

    return files;
}