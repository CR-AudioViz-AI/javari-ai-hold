// app/javari/command-center/page.tsx
// Redirects to /command-center (admin area moved out of /javari namespace)
// Tuesday, March 17, 2026
export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
export default function Page() {
  redirect('/command-center')
}
