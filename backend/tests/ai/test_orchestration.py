from pathlib import Path
import subprocess
import sys
from unittest.mock import Mock

from src.ai.embeddings import download_hugging_face_embeddings
from src.ai.ingestion import load_pdf_file, text_split
from src.ai.prompts import SYSTEM_PROMPT
from src.ai.rag import get_rag_chain


def test_embedding_model_settings_are_preserved(providers):
    result = download_hugging_face_embeddings()
    providers.embedding_class.assert_called_once_with(
        model_name="BAAI/bge-small-en-v1.5", model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
    assert result is providers.embedding_class.return_value


def test_retrieval_configuration_and_cache_are_preserved(providers):
    first = get_rag_chain()
    second = get_rag_chain()
    assert first is second is providers.retrieval_chain.return_value
    providers.embedding_class.assert_called_once()
    providers.vector_store.from_existing_index.assert_called_once_with(
        index_name="clinician", embedding=providers.embedding_class.return_value,
    )
    retriever = providers.vector_store.from_existing_index.return_value.as_retriever
    retriever.assert_called_once_with(search_type="similarity", search_kwargs={"k": 3})
    providers.llm_class.assert_called_once_with(model="gpt-4o-mini", temperature=0.4, max_tokens=500)
    providers.prompt_class.from_messages.assert_called_once_with(
        [("system", SYSTEM_PROMPT), ("human", "{input}")],
    )
    providers.document_chain.assert_called_once_with(
        providers.llm_class.return_value, providers.prompt_class.from_messages.return_value,
    )
    providers.retrieval_chain.assert_called_once_with(
        retriever.return_value, providers.document_chain.return_value,
    )


def test_pdf_loading_and_chunking_are_preserved(providers):
    documents = load_pdf_file("source-documents")
    providers.directory_loader.assert_called_once_with(
        "source-documents", glob="*.pdf", loader_cls=providers.pdf_loader,
    )
    assert documents is providers.directory_loader.return_value.load.return_value
    chunks = text_split(documents)
    providers.splitter.assert_called_once_with(chunk_size=500, chunk_overlap=20)
    providers.splitter.return_value.split_documents.assert_called_once_with(documents)
    assert chunks is providers.splitter.return_value.split_documents.return_value


def test_ingestion_preserves_index_and_upload_settings(providers, monkeypatch):
    from src.ai import ingestion

    dotenv = Mock()
    monkeypatch.setattr(ingestion, "load_dotenv", dotenv)
    monkeypatch.setenv("PINECONE_API_KEY", "test-pinecone-key")
    result = ingestion.main()
    root = Path(ingestion.__file__).resolve().parents[2]
    dotenv.assert_called_once_with(root / ".env")
    providers.directory_loader.assert_called_once_with(
        str(root / "data"), glob="*.pdf", loader_cls=providers.pdf_loader,
    )
    providers.pinecone.assert_called_once_with(api_key="test-pinecone-key")
    providers.serverless_spec.assert_called_once_with(cloud="aws", region="us-east-1")
    providers.pinecone.return_value.create_index.assert_called_once_with(
        name="clinician", dimension=384, metric="cosine",
        spec=providers.serverless_spec.return_value,
    )
    providers.vector_store.from_documents.assert_called_once_with(
        documents=providers.splitter.return_value.split_documents.return_value,
        index_name="clinician", embedding=providers.embedding_class.return_value,
    )
    assert result is providers.vector_store.from_documents.return_value


def test_api_startup_does_not_initialize_ai_providers():
    code = """
import sys
from src.api import create_app
app = create_app()
assert app.static_folder is None
assert app.template_folder is None
for name in ('langchain_openai', 'langchain_pinecone', 'langchain_community', 'sentence_transformers', 'pinecone'):
    assert name not in sys.modules, name
"""
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_ai_modules_are_independent_of_api_and_have_no_provider_side_effects():
    code = """
import sys
from src.ai import embeddings, ingestion, prompts, rag
for name in ('flask', 'src.api', 'langchain_openai', 'langchain_pinecone', 'langchain_community', 'pinecone'):
    assert name not in sys.modules, name
"""
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
