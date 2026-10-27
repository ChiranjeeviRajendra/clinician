"""Build and cache the existing retrieval-augmented generation pipeline."""
from functools import lru_cache

from .embeddings import download_hugging_face_embeddings
from .prompts import SYSTEM_PROMPT


@lru_cache(maxsize=1)
def get_rag_chain():
    from langchain_pinecone import PineconeVectorStore
    from langchain_openai import OpenAI
    from langchain_classic.chains import create_retrieval_chain
    from langchain_classic.chains.combine_documents import create_stuff_documents_chain
    from langchain_core.prompts import ChatPromptTemplate

    embeddings = download_hugging_face_embeddings()
    docsearch = PineconeVectorStore.from_existing_index(index_name="clinician", embedding=embeddings)
    retriever = docsearch.as_retriever(search_type="similarity", search_kwargs={"k": 3})
    llm = OpenAI(model="gpt-4o-mini", temperature=0.4, max_tokens=500)
    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM_PROMPT), ("human", "{input}")])
    return create_retrieval_chain(retriever, create_stuff_documents_chain(llm, prompt))
