// app/api/javari/alerts/route.ts
// ═══════════════════════════════════════════════════════════════════════════════
// JAVARI PROACTIVE ALERTS SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
// Timestamp: January 1, 2026 - 3:42 PM EST
// Version: 1.0 - AUTONOMOUS ALERTING
//
// Proactively notifies Roy of:
// - Failed deployments
// - Payment failures
// - Security issues
// - Low credit balances
// - System errors
// - Revenue milestones
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ═══════════════════════════════════════════════════════════════════════════════
// CI BUILD GUARD - Prevent Supabase init during GitHub Actions builds
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const HAS_SUPABASE_CONFIG = !!(SUPABASE_URL && SUPABASE_KEY)

const supabase = HAS_SUPABASE_CONFIG 
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Alert {
  id?: string
  alert_type: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  title: string
  message: string
  source?: string
  data?: any
  acknowledged?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT RULES - What triggers proactive alerts
// ═══════════════════════════════════════════════════════════════════════════════

const ALERT_RULES = {
  deployment_failure: {
    severity: 'error' as const,
    title: 'Deployment Failed',
    template: (data: any) => `${data.project} deployment failed: ${data.error}`
  },
  payment_failure: {
    severity: 'critical' as const,
    title: 'Payment Failed',
    template: (data: any) => `Payment of $${data.amount} failed for ${data.customer}`
  },
  low_credits: {
    severity: 'warning' as const,
    title: 'Low Credit Balance',
    template: (data: any) => `User ${data.userId} has only ${data.credits} credits remaining`
  },
  security_issue: {
    severity: 'critical' as const,
    title: 'Security Alert',
    template: (data: any) => `Security issue detected: ${data.issue}`
  },
  api_error_spike: {
    severity: 'error' as const,
    title: 'API Error Spike',
    template: (data: any) => `${data.count} errors in the last ${data.minutes} minutes on ${data.endpoint}`
  },
  revenue_milestone: {
    severity: 'info' as const,
    title: 'Revenue Milestone! 🎉',
    template: (data: any) => `Congratulations! You've hit $${data.amount} in ${data.period}`
  },
  new_subscriber: {
    severity: 'info' as const,
    title: 'New Subscriber',
    template: (data: any) => `${data.email} subscribed to ${data.plan} plan`
  },
  grant_update: {
    severity: 'info' as const,
    title: 'Grant Status Update',
    template: (data: any) => `${data.grantName}: ${data.status}`
  },
  system_health: {
    severity: 'warning' as const,
    title: 'System Health Alert',
    template: (data: any) => `${data.service} is experiencing issues: ${data.details}`
  },
  user_churn_risk: {
    severity: 'warning' as const,
    title: 'Churn Risk Detected',
    template: (data: any) => `${data.email} hasn't logged in for ${data.days} days`
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE ALERT
// ═══════════════════════════════════════════════════════════════════════════════

async function createAlert(
  alertType: keyof typeof ALERT_RULES,
  data: any,
  source?: string
): Promise<Alert> {
  if (!supabase) {
    return {
      alert_type: alertType,
      severity: 'info',
      title: 'Alert system unavailable',
      message: 'Supabase not configured',
      acknowledged: false
    }
  }

  const rule = ALERT_RULES[alertType]
  
  const alert: Alert = {
    alert_type: alertType,
    severity: rule.severity,
    title: rule.title,
    message: rule.template(data),
    source: source || 'system',
    data,
    acknowledged: false
  }
  
  // Save to database
  const { data: saved, error } = await supabase
    .from('proactive_alerts')
    .insert(alert)
    .select()
    .single()
  
  if (error) {
    console.error('Error saving alert:', error)
  }
  
  // Send notifications based on severity
  if (rule.severity === 'critical' || rule.severity === 'error') {
    await sendUrgentNotification(alert)
  }
  
  return saved || alert
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function sendUrgentNotification(alert: Alert): Promise<void> {
  // Email notification
  const emailEndpoint = process.env.NEXT_PUBLIC_APP_URL + '/api/bots/marketing'
  
  try {
    await fetch(emailEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_email',
        data: {
          to: 'royhenderson@craudiovizai.com',
          subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          body: `
            <h2>${alert.title}</h2>
            <p>${alert.message}</p>
            <p><strong>Severity:</strong> ${alert.severity}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Source:</strong> ${alert.source || 'System'}</p>
            <hr>
            <p><a href="https://javariai.com/admin/alerts">View All Alerts</a></p>
          `
        }
      })
    })
  } catch (error) {
    console.error('Error sending notification:', error)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM CHECKS - Run periodically
// ═══════════════════════════════════════════════════════════════════════════════

async function runSystemChecks(): Promise<Alert[]> {
  if (!supabase) return []
  
  const alerts: Alert[] = []
  
  // Check for recent deployment failures (mock - would connect to Vercel API)
  // In real implementation, this would check Vercel deployments
  
  // Check for low credit users
  const { data: lowCreditUsers } = await supabase
    .from('users')
    .select('id, email, credits')
    .lt('credits', 10)
    .gt('credits', 0)
  
  if (lowCreditUsers && lowCreditUsers.length > 0) {
    for (const user of lowCreditUsers.slice(0, 5)) { // Limit to 5
      const alert = await createAlert('low_credits', {
        userId: user.id,
        email: user.email,
        credits: user.credits
      }, 'credit_monitor')
      alerts.push(alert)
    }
  }
  
  // Check for inactive users (churn risk)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  const { data: inactiveUsers } = await supabase
    .from('users')
    .select('id, email, last_login')
    .lt('last_login', thirtyDaysAgo.toISOString())
    .limit(10)
  
  if (inactiveUsers && inactiveUsers.length > 0) {
    for (const user of inactiveUsers.slice(0, 3)) {
      const daysSinceLogin = Math.floor(
        (Date.now() - new Date(user.last_login).getTime()) / (1000 * 60 * 60 * 24)
      )
      const alert = await createAlert('user_churn_risk', {
        userId: user.id,
        email: user.email,
        days: daysSinceLogin
      }, 'churn_monitor')
      alerts.push(alert)
    }
  }
  
  return alerts
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

async function getAlerts(options: {
  acknowledged?: boolean
  severity?: string
  limit?: number
}): Promise<Alert[]> {
  if (!supabase) return []
  
  let query = supabase
    .from('proactive_alerts')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (options.acknowledged !== undefined) {
    query = query.eq('acknowledged', options.acknowledged)
  }
  
  if (options.severity) {
    query = query.eq('severity', options.severity)
  }
  
  if (options.limit) {
    query = query.limit(options.limit)
  }
  
  const { data } = await query
  return data || []
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGE ALERT
// ═══════════════════════════════════════════════════════════════════════════════

async function acknowledgeAlert(id: string, acknowledgedBy: string): Promise<void> {
  if (!supabase) return
  
  await supabase
    .from('proactive_alerts')
    .update({
      acknowledged: true,
      acknowledged_by: acknowledgedBy,
      acknowledged_at: new Date().toISOString()
    })
    .eq('id', id)
}

async function acknowledgeAll(acknowledgedBy: string): Promise<number> {
  if (!supabase) return 0
  
  const { data } = await supabase
    .from('proactive_alerts')
    .update({
      acknowledged: true,
      acknowledged_by: acknowledgedBy,
      acknowledged_at: new Date().toISOString()
    })
    .eq('acknowledged', false)
    .select()
  
  return data?.length || 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  // CI BUILD GUARD - Return early if Supabase not configured
  if (!HAS_SUPABASE_CONFIG) {
    return NextResponse.json({ 
      ok: true, 
      message: 'Alerts service unavailable (build mode)'
    }, { status: 200 })
  }

  try {
    const body = await request.json()
    const { action, data } = body
    
    switch (action) {
      case 'create':
        const alert = await createAlert(data.type, data.payload, data.source)
        return NextResponse.json({ success: true, alert })
      
      case 'acknowledge':
        await acknowledgeAlert(data.id, data.acknowledgedBy || 'admin')
        return NextResponse.json({ success: true, message: 'Alert acknowledged' })
      
      case 'acknowledge_all':
        const count = await acknowledgeAll(data.acknowledgedBy || 'admin')
        return NextResponse.json({ success: true, acknowledged: count })
      
      case 'run_checks':
        const newAlerts = await runSystemChecks()
        return NextResponse.json({ success: true, alerts: newAlerts })
      
      case 'test':
        // Create a test alert
        const testAlert = await createAlert('system_health', {
          service: 'Test Service',
          details: 'This is a test alert'
        }, 'test')
        return NextResponse.json({ success: true, alert: testAlert })
      
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Alerts error'
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // CI BUILD GUARD - Return empty alerts if Supabase not configured
  if (!HAS_SUPABASE_CONFIG) {
    return NextResponse.json({
      ok: true,
      alerts: [],
      message: 'Alerts service unavailable (build mode)'
    }, { status: 200 })
  }

  const { searchParams } = new URL(request.url)
  const acknowledged = searchParams.get('acknowledged')
  const severity = searchParams.get('severity')
  const limit = searchParams.get('limit')
  
  const alerts = await getAlerts({
    acknowledged: acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined,
    severity: severity || undefined,
    limit: limit ? parseInt(limit) : 50
  })
  
  const unacknowledged = alerts.filter(a => !a.acknowledged).length
  const critical = alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length
  
  return NextResponse.json({
    service: 'Javari Proactive Alerts',
    version: '1.0.0',
    alerts,
    stats: {
      total: alerts.length,
      unacknowledged,
      critical
    },
    alertTypes: Object.keys(ALERT_RULES),
    usage: {
      create: 'POST { action: "create", data: { type, payload, source } }',
      acknowledge: 'POST { action: "acknowledge", data: { id } }',
      acknowledgeAll: 'POST { action: "acknowledge_all" }',
      runChecks: 'POST { action: "run_checks" }',
      test: 'POST { action: "test" }'
    }
  })
}
