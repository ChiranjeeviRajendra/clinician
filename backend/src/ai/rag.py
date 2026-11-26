"""Build and cache the existing retrieval-augmented generation pipeline."""

from functools import lru_cache

from .embeddings import create_embeddings
from .prompts import SYSTEM_PROMPT


@lru_cache(maxsize=1)
def get_rag_chain():
    from langchain_classic.chains import create_retrieval_chain
    from langchain_classic.chains.combine_documents import create_stuff_documents_chain
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_openai import OpenAI
    from langchain_pinecone import PineconeVectorStore

    embeddings = create_embeddings()
    vector_store = PineconeVectorStore.from_existing_index(
        index_name="clinician", embedding=embeddings
    )
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 3})
    language_model = OpenAI(model="gpt-4o-mini", temperature=0.4, max_tokens=500)
    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM_PROMPT), ("human", "{input}")])
    document_chain = create_stuff_documents_chain(language_model, prompt)
    return create_retrieval_chain(retriever, document_chain)
