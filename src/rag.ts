import { FakeEmbeddings } from "@langchain/core/utils/testing";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";

const WORKSPACE = process.env.WORKSPACE || `${process.cwd()}/workspace`;

class RAGStore {
  private stores = new Map<string, MemoryVectorStore>();
  private embeddings: FakeEmbeddings;

  constructor() {
    this.embeddings = new FakeEmbeddings();
  }

  async indexSession(sessionId: string): Promise<void> {
    const sessionWorkspace = `${WORKSPACE}/${sessionId}`;
    const docs: Document[] = [];

    try {
      const glob = new Bun.Glob("**/*");
      for await (const path of glob.scan({ cwd: sessionWorkspace, onlyFiles: true })) {
        const file = Bun.file(`${sessionWorkspace}/${path}`);
        const content = await file.text();
        docs.push(new Document({ pageContent: content, metadata: { source: path } }));
      }

      if (docs.length === 0) {
        this.stores.delete(sessionId);
        return;
      }

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const splits = await splitter.splitDocuments(docs);
      const vectorStore = await MemoryVectorStore.fromDocuments(splits, this.embeddings);
      this.stores.set(sessionId, vectorStore);
    } catch {
      this.stores.delete(sessionId);
    }
  }

  async search(sessionId: string, query: string, k = 3): Promise<string> {
    const store = this.stores.get(sessionId);
    if (!store) {
      return "No documents indexed for this session. Use write_file to create documents first.";
    }

    const results = await store.similaritySearch(query, k);
    if (results.length === 0) {
      return "No relevant documents found.";
    }

    return results
      .map((doc) => `[${doc.metadata.source}]\n${doc.pageContent}`)
      .join("\n\n---\n\n");
  }

  clearSession(sessionId: string): void {
    this.stores.delete(sessionId);
  }
}

export const ragStore = new RAGStore();
