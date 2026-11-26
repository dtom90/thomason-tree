<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x'
  import type { PersonRef } from './drive-api'

  type Props = {
    options: PersonRef[]
    personId?: string
    disabled?: boolean
    placeholder?: string
    onPersonChange?: (personId: string, person: PersonRef | null) => void
  }

  let {
    options,
    personId = $bindable(''),
    disabled = false,
    placeholder = 'Search people…',
    onPersonChange,
  }: Props = $props()

  let query = $state('')
  let open = $state(false)
  let highlightIndex = $state(0)
  let rootEl: HTMLDivElement | undefined = $state()
  let inputEl: HTMLInputElement | undefined = $state()

  const selected = $derived(
    personId ? (options.find((p) => p.id === personId) ?? null) : null,
  )

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 12)
    return options.filter((p) => p.displayName.toLowerCase().includes(q)).slice(0, 12)
  })

  $effect(() => {
    const name = selected?.displayName ?? ''
    if (!open && query !== name) {
      query = name
    }
  })

  function emit(nextId: string, person: PersonRef | null) {
    personId = nextId
    onPersonChange?.(nextId, person)
  }

  function pick(person: PersonRef) {
    query = person.displayName
    open = false
    highlightIndex = 0
    emit(person.id, person)
  }

  function clear() {
    query = ''
    open = false
    highlightIndex = 0
    emit('', null)
    inputEl?.focus()
  }

  function onInput(value: string) {
    query = value
    open = true
    highlightIndex = 0
    // Typing away from a selected name unlinks immediately, but leave label
    // auto-fill to pick/clear so search edits don't wipe the label mid-type.
    if (personId) {
      const currentName = selected?.displayName ?? ''
      if (value.trim() !== currentName) {
        personId = ''
      }
    }
  }

  function onFocus() {
    if (disabled) return
    open = true
    highlightIndex = 0
  }

  function onBlur() {
    // Defer so option mousedown/click can run first.
    queueMicrotask(() => {
      if (!rootEl?.contains(document.activeElement)) {
        open = false
        query = selected?.displayName ?? ''
      }
    })
  }

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return
    if (e.key === 'Escape') {
      open = false
      query = selected?.displayName ?? ''
      inputEl?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      open = true
      highlightIndex = Math.min(highlightIndex + 1, Math.max(filtered.length - 1, 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      open = true
      highlightIndex = Math.max(highlightIndex - 1, 0)
      return
    }
    if (e.key === 'Enter' && open && filtered[highlightIndex]) {
      e.preventDefault()
      pick(filtered[highlightIndex])
    }
  }
</script>

<div class="relative" bind:this={rootEl}>
  <div class="relative">
    <input
      bind:this={inputEl}
      class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 pr-8 text-sm"
      {placeholder}
      {disabled}
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
      aria-controls="person-search-list"
      autocomplete="off"
      value={query}
      oninput={(e) => onInput(e.currentTarget.value)}
      onfocus={onFocus}
      onblur={onBlur}
      onkeydown={onKeyDown}
    />
    {#if !disabled && (personId || query)}
      <button
        type="button"
        class="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear person"
        tabindex="-1"
        onclick={clear}
      >
        <XIcon class="size-3.5" />
      </button>
    {/if}
  </div>

  {#if open && !disabled}
    <ul
      id="person-search-list"
      class="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="listbox"
    >
      {#each filtered as person, i (person.id)}
        <li role="option" aria-selected={person.id === personId}>
          <button
            type="button"
            class="flex w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground {i ===
            highlightIndex
              ? 'bg-accent text-accent-foreground'
              : ''}"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(person)}
          >
            {person.displayName}
          </button>
        </li>
      {:else}
        <li class="px-3 py-1.5 text-muted-foreground">No matches</li>
      {/each}
    </ul>
  {/if}
</div>
