<script lang="ts">
  import * as storage from '../../src/components/runners/chainStorage';
  import * as trail from '../../src/components/runners/hopTrail';
  Object.assign(window, { chainHandoverProbe: { storage, trail } });
</script>

<p>Native file handover and tab-local trail controls</p>
