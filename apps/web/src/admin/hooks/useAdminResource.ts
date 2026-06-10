import {
	type DependencyList,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { mapAdminError } from '../../i18n/api-error-messages';

/**
 * Loads a single admin resource, replacing the `let cancelled = false; void (async () => { try … catch
 * (err) { setError(err instanceof AdminApiError ? formatAdminApiError(…) : t(…)) } finally { setLoading(false) }
 * })(); return () => { cancelled = true }` effect copy-pasted across ~14 admin pages (Prompt 38 §A16 / §6.9).
 *
 * Out-of-order protection uses a monotonic `requestIdRef` (same guard as {@link useIdentityListQuery}):
 * only the latest in-flight load may commit state. An `aliveRef` flag drops any load that resolves after
 * unmount. `loader` is held in a ref so callers may pass an inline closure without memoising it. The load
 * runs on mount and re-runs whenever `options.deps` change (pass the route params the loader closes over,
 * just like the original effect's dependency array); `reload()` triggers it imperatively.
 */
export function useAdminResource<T>(
	loader: () => Promise<T>,
	options: { fallbackKey: string; deps?: DependencyList },
): {
	data: T | null;
	loading: boolean;
	error: string | null;
	reload: () => void;
	setData: Dispatch<SetStateAction<T | null>>;
	setError: Dispatch<SetStateAction<string | null>>;
} {
	const { fallbackKey, deps = [] } = options;
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const requestIdRef = useRef(0);
	const aliveRef = useRef(true);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	const reload = useCallback(() => {
		const requestId = ++requestIdRef.current;
		setLoading(true);
		setError(null);
		void (async () => {
			try {
				const result = await loaderRef.current();
				if (aliveRef.current && requestId === requestIdRef.current) {
					setData(result);
				}
			} catch (err) {
				if (aliveRef.current && requestId === requestIdRef.current) {
					setError(mapAdminError(err, fallbackKey));
				}
			} finally {
				if (aliveRef.current && requestId === requestIdRef.current) {
					setLoading(false);
				}
			}
		})();
	}, [fallbackKey]);

	useEffect(() => {
		aliveRef.current = true;
		reload();
		return () => {
			aliveRef.current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- caller-supplied deps drive re-loads
	}, [reload, ...deps]);

	return { data, loading, error, reload, setData, setError };
}
