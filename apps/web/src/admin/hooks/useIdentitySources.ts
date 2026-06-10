import { useEffect, useMemo, useState } from 'react';
import type { IdentitySourceOptionDto } from '@nestidp/shared';
import { listIdentitySources } from '../adminApi';

/**
 * Loads the identity sync-source options once and exposes a stable id→label resolver (Prompt 38 §A15 / §6.9).
 * Extracted from the identical `useState + useEffect(listIdentitySources…catch([])) + useMemo(label map)`
 * block that was copy-pasted across the user / group / role list pages. A failed load degrades to an empty
 * option set (the source filter simply shows no extra sources), matching the previous per-page behaviour.
 */
export function useIdentitySources(): {
	sources: IdentitySourceOptionDto[];
	sourceLabel: (apiConnectionId: string) => string;
} {
	const [sources, setSources] = useState<IdentitySourceOptionDto[]>([]);

	useEffect(() => {
		void listIdentitySources()
			.then((res) => setSources(res.sources))
			.catch(() => setSources([]));
	}, []);

	const sourceLabel = useMemo(() => {
		const map = new Map(sources.map((s) => [s.apiConnectionId, s.label]));
		return (id: string) => map.get(id) ?? id;
	}, [sources]);

	return { sources, sourceLabel };
}
