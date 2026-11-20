import { retiredApiResponse } from '../_lib/retired';
import type { PagesFunction } from '../_lib/types';

export const onRequest: PagesFunction = () => retiredApiResponse();
