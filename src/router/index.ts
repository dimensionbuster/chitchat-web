import { createRouter, createWebHashHistory } from 'vue-router'

import Home from '../pages/Home.vue'
import ChatRoom from '../pages/ChatRoom.vue'
import Notification from '../pages/Notification.vue'
import Dialog from '../pages/Dialog.vue'
import Settings from '../pages/Settings.vue'

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
        messageId: (route.query.messageId as string) || '',
        roomId: (route.query.roomId as string) || '',
      }),
    },
    {
      path: '/dialog',
      name: 'Dialog',
      component: Dialog,
      props: (route) => ({
        message: (route.query.message as string) || '',
        type: (route.query.type as 'alert' | 'confirm') || 'alert',
        dialogId: (route.query.dialogId as string) || '',
      }),
    },
    {
      path: '/settings',
      name: 'Settings',
      component: Settings,
    },
  ],
})

export default router
