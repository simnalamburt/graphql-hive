import { execute } from './preflight-script';

self.onmessage = async event => {
  const result = await execute(event.data);
  self.postMessage(result);
};
