"""AI provider doubles: tests never load models or call external services."""
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def providers(monkeypatch):
    modules = {}
    for name in (
        "langchain_community", "langchain_community.embeddings",
        "langchain_community.document_loaders", "langchain_text_splitters",
        "langchain_pinecone", "langchain_openai", "langchain_classic",
        "langchain_classic.chains", "langchain_classic.chains.combine_documents",
        "langchain_core", "langchain_core.prompts", "pinecone",
    ):
        module = ModuleType(name)
        module.__path__ = []
        modules[name] = module
        monkeypatch.setitem(sys.modules, name, module)

    doubles = SimpleNamespace(
        embedding_class=Mock(), vector_store=Mock(), llm_class=Mock(),
        prompt_class=Mock(), retrieval_chain=Mock(), document_chain=Mock(),
        directory_loader=Mock(), pdf_loader=Mock(), splitter=Mock(),
        pinecone=Mock(), serverless_spec=Mock(),
    )
    modules["langchain_community.embeddings"].HuggingFaceEmbeddings = doubles.embedding_class
    modules["langchain_community.document_loaders"].DirectoryLoader = doubles.directory_loader
    modules["langchain_community.document_loaders"].PyPDFLoader = doubles.pdf_loader
    modules["langchain_text_splitters"].RecursiveCharacterTextSplitter = doubles.splitter
    modules["langchain_pinecone"].PineconeVectorStore = doubles.vector_store
    modules["langchain_openai"].OpenAI = doubles.llm_class
    modules["langchain_classic.chains"].create_retrieval_chain = doubles.retrieval_chain
    modules["langchain_classic.chains.combine_documents"].create_stuff_documents_chain = doubles.document_chain
    modules["langchain_core.prompts"].ChatPromptTemplate = doubles.prompt_class
    modules["pinecone"].Pinecone = doubles.pinecone
    modules["pinecone"].ServerlessSpec = doubles.serverless_spec

    from src.ai.rag import get_rag_chain
    get_rag_chain.cache_clear()
    yield doubles
    get_rag_chain.cache_clear()
