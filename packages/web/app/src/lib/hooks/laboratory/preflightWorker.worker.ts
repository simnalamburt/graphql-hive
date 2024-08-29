import { execute } from './preflightWorker';

self.onmessage = async event => {
  const result = await execute(event.data);
  self.postMessage(result);
};
