import { setInterval } from 'node:timers';

// This owned test worker deliberately remains active until controller cleanup.
setInterval(() => {}, 1000);
