// app/javari/chat/page.tsx
// Chat is now at /javari — redirecting
// Tuesday, March 17, 2026
export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
export default function Page() {
  redirect('/javari')
}
