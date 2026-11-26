"""Load PDFs, split documents, and populate the existing Pinecone index."""

import os
from pathlib import Path

from dotenv import load_dotenv

from .embeddings import create_embeddings


def load_pdf_documents(directory):
    from langchain_community.document_loaders import DirectoryLoader, PyPDFLoader

    loader = DirectoryLoader(directory, glob="*.pdf", loader_cls=PyPDFLoader)
    return loader.load()


def split_documents(documents):
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
    return splitter.split_documents(documents)


def main():
    from langchain_pinecone import PineconeVectorStore
    from pinecone import Pinecone, ServerlessSpec

    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    documents = load_pdf_documents(str(root / "data"))
    chunks = split_documents(documents)
    embeddings = create_embeddings()

    client = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
    index_name = "clinician"
    client.create_index(
        name=index_name,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    return PineconeVectorStore.from_documents(
        documents=chunks,
        index_name=index_name,
        embedding=embeddings,
    )


if __name__ == "__main__":
    main()
