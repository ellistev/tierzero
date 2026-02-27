"""
CodebaseChat - RAG-powered codebase Q&A agent
Built with LangGraph + LangChain + ChromaDB

Demonstrates:
- RAG (Retrieval-Augmented Generation) with vector embeddings
- LangGraph agent with tool use and state management
- ChromaDB for local vector storage
- Code-aware chunking and retrieval
- Extensible to Azure OpenAI

Usage:
  python codebase_chat.py ingest <path>    # Index a codebase
  python codebase_chat.py chat             # Chat with the indexed codebase
  python codebase_chat.py ask "question"   # One-shot question
"""

import os
import sys
import glob
import hashlib
from pathlib import Path
from typing import Literal, Annotated
import operator

from dotenv import load_dotenv
load_dotenv()

# --- LangChain imports ---
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.documents import Document
from langchain_core.tools import tool

# --- LangGraph imports ---
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

# ============================================================
# Config
# ============================================================
CHROMA_DIR = os.path.join(os.path.dirname(__file__), ".chroma_db")
COLLECTION_NAME = "codebase"

# File extensions to index
CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".cs", ".java",
    ".go", ".rs", ".rb", ".php", ".swift", ".kt",
    ".sql", ".sh", ".ps1", ".bash",
    ".json", ".yaml", ".yml", ".toml",
    ".md", ".txt", ".rst",
    ".html", ".css", ".scss",
    ".dockerfile", ".tf", ".bicep",
}

# Directories to skip
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", "bin", "obj", ".next", ".nuxt",
    "coverage", ".pytest_cache", ".mypy_cache",
    ".chroma_db", ".tox", "eggs", "*.egg-info",
}

# Map file extensions to LangChain Language enums for smart splitting
LANG_MAP = {
    ".py": Language.PYTHON,
    ".ts": Language.TS,
    ".tsx": Language.TS,
    ".js": Language.JS,
    ".jsx": Language.JS,
    ".cs": Language.CSHARP,
    ".go": Language.GO,
    ".rs": Language.RUST,
    ".rb": Language.RUBY,
    ".java": Language.JAVA,
    ".php": Language.PHP,
    ".swift": Language.SWIFT,
    ".md": Language.MARKDOWN,
    ".html": Language.HTML,
}

# ============================================================
# Embeddings & Vector Store
# ============================================================
def get_embeddings():
    """Get embeddings model - OpenAI by default, Azure OpenAI if configured."""
    if os.getenv("AZURE_OPENAI_API_KEY"):
        from langchain_openai import AzureOpenAIEmbeddings
        return AzureOpenAIEmbeddings(
            azure_deployment=os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        )
    return OpenAIEmbeddings(model="text-embedding-3-small")


def get_vectorstore():
    """Get or create the ChromaDB vector store."""
    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=get_embeddings(),
        persist_directory=CHROMA_DIR,
    )


def get_llm():
    """Get the LLM - OpenAI by default, Azure OpenAI if configured."""
    if os.getenv("AZURE_OPENAI_API_KEY"):
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            temperature=0,
        )
    return ChatOpenAI(model="gpt-4o-mini", temperature=0)


# ============================================================
# Ingestion
# ============================================================
def should_skip_dir(dir_name: str) -> bool:
    return dir_name in SKIP_DIRS or dir_name.startswith(".")


def collect_files(root_path: str) -> list[Path]:
    """Walk directory tree and collect indexable files."""
    root = Path(root_path)
    files = []
    try:
        for path in root.rglob("*"):
            try:
                # Skip excluded directories
                if any(should_skip_dir(part) for part in path.parts):
                    continue
                if path.is_file() and path.suffix.lower() in CODE_EXTENSIONS:
                    # Skip very large files (>100KB)
                    if path.stat().st_size <= 100_000:
                        files.append(path)
            except (OSError, PermissionError):
                continue
    except (OSError, PermissionError):
        pass
    return files


def chunk_file(file_path: Path, root_path: str) -> list[Document]:
    """Read and chunk a single file with language-aware splitting."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    if not content.strip():
        return []

    rel_path = str(file_path.relative_to(root_path))
    ext = file_path.suffix.lower()

    # Use language-aware splitter if available
    lang = LANG_MAP.get(ext)
    if lang:
        splitter = RecursiveCharacterTextSplitter.from_language(
            language=lang,
            chunk_size=1500,
            chunk_overlap=200,
        )
    else:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=200,
        )

    chunks = splitter.create_documents(
        texts=[content],
        metadatas=[{
            "source": rel_path,
            "language": ext.lstrip("."),
            "file_hash": hashlib.md5(content.encode()).hexdigest()[:12],
        }],
    )

    # Add chunk index to metadata
    for i, chunk in enumerate(chunks):
        chunk.metadata["chunk_index"] = i
        chunk.metadata["total_chunks"] = len(chunks)

    return chunks


def ingest(root_path: str):
    """Index an entire codebase into ChromaDB."""
    root_path = os.path.abspath(root_path)
    print(f"\n--- CodebaseChat Ingestion ---")
    print(f"Root: {root_path}")

    # Collect files
    files = collect_files(root_path)
    print(f"Found {len(files)} indexable files")

    if not files:
        print("No files to index!")
        return

    # Chunk all files
    all_chunks = []
    for f in files:
        chunks = chunk_file(f, root_path)
        all_chunks.extend(chunks)

    print(f"Created {len(all_chunks)} chunks")

    # Create vector store and add documents
    vectorstore = get_vectorstore()

    # Add in batches to avoid memory issues
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i:i + batch_size]
        vectorstore.add_documents(batch)
        print(f"  Indexed {min(i + batch_size, len(all_chunks))}/{len(all_chunks)} chunks")

    print(f"\nDone! Vector store saved to {CHROMA_DIR}")
    print(f"Total chunks indexed: {len(all_chunks)}")


# ============================================================
# RAG Tool
# ============================================================
# Global vectorstore reference for tool use
_vectorstore = None

def get_retriever():
    global _vectorstore
    if _vectorstore is None:
        _vectorstore = get_vectorstore()
    return _vectorstore


@tool
def search_codebase(query: str) -> str:
    """Search the indexed codebase for relevant code snippets and documentation.

    Use this to find:
    - Function/class definitions
    - Configuration files
    - Documentation
    - How specific features are implemented
    - Error handling patterns
    - API endpoints and routes

    Args:
        query: Natural language description of what you're looking for
    """
    vs = get_retriever()
    results = vs.similarity_search_with_score(query, k=6)

    if not results:
        return "No relevant code found in the indexed codebase."

    output_parts = []
    for doc, score in results:
        source = doc.metadata.get("source", "unknown")
        chunk_idx = doc.metadata.get("chunk_index", "?")
        total = doc.metadata.get("total_chunks", "?")
        output_parts.append(
            f"--- {source} (chunk {chunk_idx}/{total}, relevance: {1-score:.2f}) ---\n"
            f"{doc.page_content}\n"
        )

    return "\n".join(output_parts)


@tool
def list_indexed_files(file_pattern: str = "") -> str:
    """List files that have been indexed in the codebase.

    Args:
        file_pattern: Optional filter pattern (e.g., '.cs' or 'Controller')
    """
    vs = get_retriever()
    # Get all unique sources from the collection
    collection = vs._collection
    result = collection.get(include=["metadatas"])

    sources = set()
    for meta in result["metadatas"]:
        if meta and "source" in meta:
            sources.add(meta["source"])

    sources = sorted(sources)
    if file_pattern:
        sources = [s for s in sources if file_pattern.lower() in s.lower()]

    if not sources:
        return "No indexed files found" + (f" matching '{file_pattern}'" if file_pattern else "") + "."

    return f"Indexed files ({len(sources)}):\n" + "\n".join(f"  {s}" for s in sources)


# ============================================================
# LangGraph Agent
# ============================================================
class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    tool_calls_count: int


SYSTEM_PROMPT = """You are CodebaseChat, an AI assistant that helps developers understand codebases.

You have access to a vector-indexed codebase. Use the search_codebase tool to find relevant code
when answering questions. Always ground your answers in the actual code - cite file paths and
show relevant snippets.

When analyzing code:
- Explain the architecture and patterns used
- Identify dependencies and relationships between components
- Point out potential issues or improvements
- Be specific - reference actual file paths, function names, and line context

If the user asks about something not in the codebase, say so clearly.
"""


def build_agent():
    """Build the LangGraph agent with RAG tools."""
    llm = get_llm()
    tools = [search_codebase, list_indexed_files]
    tools_by_name = {t.name: t for t in tools}
    model_with_tools = llm.bind_tools(tools)

    def agent_node(state: AgentState):
        """LLM decides whether to search codebase or respond."""
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
        response = model_with_tools.invoke(messages)
        return {
            "messages": [response],
            "tool_calls_count": state.get("tool_calls_count", 0) + 1,
        }

    def tool_node(state: AgentState):
        """Execute tool calls from the LLM."""
        
        last_message = state["messages"][-1]
        results = []
        for tool_call in last_message.tool_calls:
            tool_fn = tools_by_name[tool_call["name"]]
            result = tool_fn.invoke(tool_call["args"])
            results.append(ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"],
            ))
        return {"messages": results}

    def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
        """Route to tools or end based on LLM response."""
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            # Safety: limit tool calls to prevent infinite loops
            if state.get("tool_calls_count", 0) >= 10:
                return "__end__"
            return "tools"
        return "__end__"

    # Build the graph
    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, ["tools", "__end__"])
    graph.add_edge("tools", "agent")

    return graph.compile()


# ============================================================
# Chat Interface
# ============================================================
def ask(question: str) -> str:
    """Ask a single question about the codebase."""
    agent = build_agent()
    result = agent.invoke({
        "messages": [HumanMessage(content=question)],
        "tool_calls_count": 0,
    })
    # Get the last AI message
    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage):
            return msg.content
    return "No response generated."


def chat():
    """Interactive chat loop."""
    agent = build_agent()
    messages = []

    print("\n--- CodebaseChat ---")
    print("Chat with your codebase. Type 'quit' to exit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            break

        messages.append(HumanMessage(content=user_input))

        result = agent.invoke({
            "messages": messages,
            "tool_calls_count": 0,
        })

        # Extract AI response
        ai_response = None
        for msg in reversed(result["messages"]):
            if isinstance(msg, AIMessage) and msg.content:
                ai_response = msg
                break

        if ai_response:
            print(f"\nCodebaseChat: {ai_response.content}\n")
            # Keep conversation history (just human + AI, not tool messages)
            messages.append(ai_response)
        else:
            print("\n(No response)\n")


# ============================================================
# CLI
# ============================================================
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    command = sys.argv[1].lower()

    if command == "ingest":
        if len(sys.argv) < 3:
            print("Usage: python codebase_chat.py ingest <path>")
            return
        ingest(sys.argv[2])

    elif command == "chat":
        chat()

    elif command == "ask":
        if len(sys.argv) < 3:
            print("Usage: python codebase_chat.py ask \"your question\"")
            return
        question = " ".join(sys.argv[2:])
        answer = ask(question)
        print(f"\n{answer}")

    else:
        print(f"Unknown command: {command}")
        print(__doc__)


if __name__ == "__main__":
    main()
