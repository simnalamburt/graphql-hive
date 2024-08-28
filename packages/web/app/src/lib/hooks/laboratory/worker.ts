import { endpoint } from '@shopify/web-worker/worker';
import * as api from './execute';

endpoint.expose(api);
