"""Load PDFs, split documents, and populate the existing Pinecone index."""
from pathlib import Path
import os

from dotenv import load_dotenv

from .embeddings import download_hugging_face_embeddings


def load_pdf_file(data):
    from langchain_community.document_loaders import DirectoryLoader, PyPDFLoader

    loader = DirectoryLoader(data, glob="*.pdf", loader_cls=PyPDFLoader)
    return loader.load()


def text_split(extracted_data):
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
    return splitter.split_documents(extracted_data)


def main():
    from pinecone import Pinecone, ServerlessSpec
    from langchain_pinecone import PineconeVectorStore

    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    extracted_data = load_pdf_file(data=str(root / "data"))
    text_chunks = text_split(extracted_data)
    embeddings = download_hugging_face_embeddings()

    pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
    index_name = "clinician"
    pc.create_index(
        name=index_name,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    return PineconeVectorStore.from_documents(
        documents=text_chunks, index_name=index_name, embedding=embeddings,
    )


if __name__ == "__main__":
    main()
