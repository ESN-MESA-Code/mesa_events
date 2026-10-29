import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

// Outside the member area (and anything the (app) layout does not catch).
export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col">
      <header className="bg-esn text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center">
          <Link href="/" aria-label="ESN MESA Events – home">
            <BrandMark product="Events" />
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm text-center space-y-3" data-testid="not-found">
          <h1 className="text-2xl font-bold text-gray-900">Not found</h1>
          <p className="text-sm text-gray-600">This page does not exist, or it is not available to you.</p>
          <Link href="/" className="inline-flex h-9 items-center rounded-md bg-esn px-4 text-sm font-medium text-white hover:bg-esn-dark">
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
