<script setup lang="ts">
defineOptions({ name: 'HomePage' })
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const roomId = ref(localStorage.getItem('roomId') || 'default-room')
const name = ref(localStorage.getItem('name') || '')

if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}
const goChat = () => {
  const q: Record<string, string> = {}
  if (roomId.value.trim()) q.roomId = roomId.value.trim()
  if (name.value.trim()) q.name = name.value.trim()
  localStorage.setItem('name', name.value.trim())
  localStorage.setItem('roomId', roomId.value.trim())
  router.push({ name: 'ChatRoom', query: q })
}
</script>

<template>
  <div style="height: 100%; display: grid; place-items: center; padding: 24px">
    <div style="width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 12px">
      <h1>ChitChat - decentralized</h1>
      <label style="display: flex; flex-direction: column; gap: 6px">
        <span>Room ID</span>
        <input
          v-model="roomId"
          placeholder="Enter room id"
          style="padding: 8px; border: 1px solid #ccc"
        />
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px">
        <span>이름</span>
        <input
          v-model="name"
          placeholder="너의 이름은"
          style="padding: 8px; border: 1px solid #ccc"
          @keypress.enter="goChat"
        />
      </label>
      <button @click="goChat" style="padding: 10px 12px">들어가기</button>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
