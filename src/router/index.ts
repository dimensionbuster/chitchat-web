import { createRouter, createWebHashHistory } from 'vue-router'

import Home from '../pages/Home.vue'
import ChatRoom from '../pages/ChatRoom.vue'
import Notification from '../pages/Notification.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home,
    },
    {
      path: '/chat',
      name: 'ChatRoom',
      component: ChatRoom,
      props: (route) => ({
        roomId: (route.query.roomId as string) || 'default-room',
        name: (route.query.name as string) || '',
      }),
    },
    {
      path: '/notification',
      name: 'Notification',
      component: Notification,
      props: (route) => ({
        authorName: (route.query.authorName as string) || 'Unknown',
        text: (route.query.text as string) || '',
      }),
    },
  ],
})

export default router
