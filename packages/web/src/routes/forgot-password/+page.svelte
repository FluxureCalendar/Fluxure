<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // No email/password auth — redirect to login
  onMount(() => {
    goto('/login', { replaceState: true });
  });
</script>
