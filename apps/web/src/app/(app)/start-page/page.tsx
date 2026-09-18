'use client';
import { TopBar } from '@/components/shell/TopBar';
import { StartPageEditor } from '@/components/startpage/StartPageEditor';

export default function StartPageRoute() {
  return <><TopBar title="Start Page" /><main className="content" id="main" style={{ maxWidth: 'none' }}><StartPageEditor /></main></>;
}
