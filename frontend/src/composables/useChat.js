import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { sendMessage } from '../services/chat.js'
import { useRequestError } from './useRequestError.js'

export function useChat() {
  const auth = useAuthStore()
  const messages = ref([])
  const draft = ref('')
  const pending = ref(false)
  const controller = new AbortController()
  const { error, handleError } = useRequestError(controller.signal)
  onBeforeUnmount(() => controller.abort())
  const lastQuestion = ref('')
  const scrollArea = ref(null)
  const composer = ref(null)
  const userInitial = computed(() => (auth.displayName || 'Y')[0].toUpperCase())
  const conversationTitle = computed(() => messages.value[0]?.content || 'Your first conversation')
  const suggestions = [
    { category: 'UNDERSTAND THE BASICS', question: 'What is hypertension?' },
    { category: 'EXPLORE A TOPIC', question: 'What are common symptoms of diabetes?' },
    { category: 'BUILD YOUR KNOWLEDGE', question: 'How does the immune system work?' },
  ]

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(value),
    )
  }

  function addMessage(role, content) {
    messages.value.push({
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
    })
  }

  async function scrollToLatest() {
    await nextTick()
    if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  }

  function onComposerKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  async function submit(question = draft.value, isRetry = false) {
    const text = question.trim()
    if (!text || pending.value) return
    pending.value = true
    error.value = ''
    lastQuestion.value = text
    draft.value = ''
    if (!isRetry) addMessage('user', text)
    await scrollToLatest()
    try {
      const response = await sendMessage(text, auth.sessionToken, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (typeof response?.answer !== 'string')
        throw new Error('The assistant returned an unexpected response. Please try again.')
      addMessage('assistant', response.answer)
    } catch (failure) {
      await handleError(failure)
    } finally {
      pending.value = false
      await scrollToLatest()
      composer.value?.focus()
    }
  }

  function retry() {
    return submit(lastQuestion.value, true)
  }

  function newConversation() {
    if (pending.value) return
    messages.value = []
    draft.value = ''
    error.value = ''
    lastQuestion.value = ''
    composer.value?.focus()
  }

  return {
    messages,
    draft,
    pending,
    error,
    scrollArea,
    composer,
    userInitial,
    conversationTitle,
    suggestions,
    formatTime,
    onComposerKey,
    submit,
    retry,
    newConversation,
  }
}
