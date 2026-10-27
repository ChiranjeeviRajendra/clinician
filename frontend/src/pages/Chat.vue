<template>
  <div class="workspace">
    <aside class="workspace-sidebar">
      <span class="eyebrow muted">YOUR WORKSPACE</span>
      <button class="new-chat-button" :disabled="pending" @click="newConversation"><span aria-hidden="true">+</span> New conversation</button>
      <span class="sidebar-label">CONVERSATIONS</span>
      <div class="current-conversation"><span aria-hidden="true">◌</span><span>{{ conversationTitle }}</span></div>
      <div class="sidebar-bottom"><BrandMark /><p>A little context.<br /><strong>A clearer perspective.</strong></p><span class="sidebar-divider"></span><span class="sidebar-note">Grounded in your medical<br />reference library.</span></div>
    </aside>

    <section class="chat-workspace" aria-labelledby="chat-heading">
      <header class="chat-toolbar">
        <span><span class="muted">Workspace</span><span class="breadcrumb-slash">/</span>Medical assistant</span>
        <span class="library-badge"><span class="status-dot"></span> Reference library</span>
      </header>

      <div ref="scrollArea" class="chat-scroll-area">
        <div v-if="!messages.length" class="chat-welcome">
          <span class="welcome-mark" aria-hidden="true">✳</span>
          <span class="eyebrow muted">A GOOD PLACE TO START</span>
          <h1 id="chat-heading">What would you like<br />to <span>understand?</span></h1>
          <p>Bring your questions. Let’s find a little clarity<br class="desktop-break" /> in the medical reference library.</p>
          <div class="suggestion-grid">
            <button v-for="suggestion in suggestions" :key="suggestion.question" @click="submit(suggestion.question)">
              <span class="suggestion-category">{{ suggestion.category }}</span>
              <span>{{ suggestion.question }}</span>
              <span class="suggestion-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
        </div>

        <div v-else class="message-list" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
          <h1 id="chat-heading" class="sr-only">Medical assistant conversation</h1>
          <article v-for="message in messages" :key="message.id" class="chat-message" :class="message.role">
            <div class="message-avatar" aria-hidden="true"><BrandMark v-if="message.role === 'assistant'" /><span v-else>{{ userInitial }}</span></div>
            <div class="message-body">
              <div class="message-heading"><strong>{{ message.role === 'assistant' ? 'Clinician' : 'You' }}</strong><time :datetime="message.createdAt">{{ formatTime(message.createdAt) }}</time></div>
              <p>{{ message.content }}</p>
            </div>
          </article>
          <div v-if="pending" class="chat-message assistant" role="status"><div class="message-avatar"><BrandMark /></div><div class="thinking"><span></span><span></span><span></span><span class="sr-only">Looking through the reference library…</span></div></div>
          <div v-if="error" class="chat-error notice error" role="alert"><p>{{ error }}</p><button class="inline-button" :disabled="pending" @click="retry">Try again →</button></div>
        </div>
      </div>

      <div class="composer-container">
        <form class="chat-composer" @submit.prevent="submit()">
          <label for="chat-message" class="sr-only">Your medical question</label>
          <textarea id="chat-message" ref="composer" v-model="draft" placeholder="Ask a question. Start a conversation." maxlength="8000" rows="2" :disabled="pending" aria-describedby="composer-hint" @keydown="onComposerKey"></textarea>
          <div class="composer-bottom"><span><span class="composer-spark" aria-hidden="true">✳</span> Medical reference assistant</span><button class="send-button" type="submit" :disabled="pending || !draft.trim()" aria-label="Send message"><span aria-hidden="true">↑</span></button></div>
        </form>
        <p id="composer-hint" class="composer-hint"><span>Answers are based on the available reference material.</span><span>Enter to send · Shift + Enter for a new line</span></p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { useAuthStore } from '../stores/auth.js'
import { sendMessage } from '../services/chat.js'

const router = useRouter()
const auth = useAuthStore()
const messages = ref([])
const draft = ref('')
const pending = ref(false)
const error = ref('')
const lastQuestion = ref('')
const scrollArea = ref(null)
const composer = ref(null)
const userInitial = computed(() => (auth.user?.name || auth.user?.email || 'Y')[0].toUpperCase())
const conversationTitle = computed(() => messages.value[0]?.content || 'Your first conversation')
const suggestions = [
  { category: 'UNDERSTAND THE BASICS', question: 'What is hypertension?' },
  { category: 'EXPLORE A TOPIC', question: 'What are common symptoms of diabetes?' },
  { category: 'BUILD YOUR KNOWLEDGE', question: 'How does the immune system work?' },
]

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function addMessage(role, content) {
  messages.value.push({ id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() })
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
    const response = await sendMessage(text, auth.sessionToken)
    if (typeof response.answer !== 'string') throw new Error('The assistant returned an unexpected response. Please try again.')
    addMessage('assistant', response.answer)
  } catch (failure) {
    if (failure.status === 401) {
      auth.clearSession()
      await router.replace({ name: 'login', query: { expired: '1' } })
    } else {
      error.value = failure.message
    }
  } finally {
    pending.value = false
    await scrollToLatest()
    composer.value?.focus()
  }
}

function retry() {
  submit(lastQuestion.value, true)
}

function newConversation() {
  messages.value = []
  draft.value = ''
  error.value = ''
  lastQuestion.value = ''
  composer.value?.focus()
}
</script>
