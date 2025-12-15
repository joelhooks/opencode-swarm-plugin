import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

/**
 * Docs layout wrapper using Fumadocs DocsLayout.
 * No tab icons - using flat user-intent navigation structure.
 */
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout tree={source.pageTree} {...baseOptions()}>
			{children}
		</DocsLayout>
	);
}
