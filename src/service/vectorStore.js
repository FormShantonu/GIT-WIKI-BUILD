import { createHash } from "node:crypto";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001",
  apiKey: process.env.GOOGLE_API_KEY,
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  outputDimensionality: 768,
});
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const UPSERT_BATCH_SIZE = 100;
const DEFAULT_TOP_K = 5;

function repoToNamespace(repo) {
  return repo.replace("/", "-");
}

function getIndex(namespace) {
  return pc
    .Index(process.env.PINECONE_INDEX_NAME || "git-wiki")
    .namespace(namespace);
}

function normalizeDocuments(documents) {
  return documents
    .map((doc) => ({
      pageContent: typeof doc.pageContent === "string" ? doc.pageContent : "",
      metadata: doc.metadata ?? {},
    }))
    .filter((doc) => doc.pageContent.trim().length > 0);
}

function buildRecordId(repo, metadata = {}, text = "") {
  const source = `${repo}:${metadata.path ?? "unknown"}:${text}`;
  return createHash("sha256").update(source).digest("hex");
}

export async function saveChunks(repo, documents) {
  const chunks = normalizeDocuments(documents);

  if (!chunks.length) {
    return { saved: false, chunkCount: 0 };
  }

  const namespace = repoToNamespace(repo);
  const index = getIndex(namespace);
  const texts = chunks.map((doc) => doc.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  const records = chunks.map((doc, i) => ({
    id: buildRecordId(repo, doc.metadata, doc.pageContent),
    values: vectors[i],
    metadata: {
      text: doc.pageContent,
      path: doc.metadata.path,
      repo: doc.metadata.repo ?? repo,
    },
  }));

  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    await index.upsert(records.slice(i, i + UPSERT_BATCH_SIZE));
  }

  return { saved: true, chunkCount: chunks.length };
}

function toSearchDocument(match) {
  const metadata = match.metadata ?? {};

  return {
    pageContent: metadata.text ?? "",
    metadata: {
      path: metadata.path,
      repo: metadata.repo,
    },
    score: match.score,
  };
}

export async function search(repo, question, topK = DEFAULT_TOP_K) {
  const namespace = repoToNamespace(repo);
  const index = getIndex(namespace);
  const vector = await embeddings.embedQuery(question);

  const response = await index.query({
    vector,
    topK,
    includeMetadata: true,
  });

  return (response.matches ?? [])
    .map(toSearchDocument)
    .filter((doc) => doc.pageContent.trim().length > 0);
}
