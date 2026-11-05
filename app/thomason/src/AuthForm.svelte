<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import { supabase } from '$lib/supabase'

  let mode = $state<'signin' | 'signup'>('signin')
  let email = $state('')
  let password = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let info = $state<string | null>(null)

  async function submit(event: Event) {
    event.preventDefault()
    busy = true
    error = null
    info = null
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })
        if (signUpError) throw signUpError
        if (data.user && !data.session) {
          info = 'Check your email to confirm your account, then sign in.'
          mode = 'signin'
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Authentication failed'
    } finally {
      busy = false
    }
  }
</script>

<div class="flex min-h-[calc(100dvh-0px)] items-center justify-center bg-background px-4">
  <form
    class="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
    onsubmit={submit}
  >
    <div class="space-y-1">
      <h1 class="text-lg font-semibold tracking-tight">Thomason family tree</h1>
      <p class="text-sm text-muted-foreground">
        {mode === 'signin' ? 'Sign in to view the tree.' : 'Create an account to view the tree.'}
      </p>
    </div>

    <label class="block space-y-1.5 text-sm">
      <span class="font-medium">Email</span>
      <input
        class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
        type="email"
        autocomplete="email"
        required
        bind:value={email}
      />
    </label>

    <label class="block space-y-1.5 text-sm">
      <span class="font-medium">Password</span>
      <input
        class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
        type="password"
        autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
        required
        minlength="6"
        bind:value={password}
      />
    </label>

    {#if error}
      <p class="text-sm text-destructive">{error}</p>
    {/if}
    {#if info}
      <p class="text-sm text-muted-foreground">{info}</p>
    {/if}

    <Button class="w-full" type="submit" disabled={busy}>
      {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
    </Button>

    <p class="text-center text-sm text-muted-foreground">
      {#if mode === 'signin'}
        No account?
        <button
          type="button"
          class="text-foreground underline-offset-4 hover:underline"
          onclick={() => {
            mode = 'signup'
            error = null
            info = null
          }}
        >
          Sign up
        </button>
      {:else}
        Already have an account?
        <button
          type="button"
          class="text-foreground underline-offset-4 hover:underline"
          onclick={() => {
            mode = 'signin'
            error = null
            info = null
          }}
        >
          Sign in
        </button>
      {/if}
    </p>
  </form>
</div>
