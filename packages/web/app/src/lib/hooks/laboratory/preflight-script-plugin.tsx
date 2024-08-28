import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToggle } from '@/lib/hooks';
import { GraphiQLPlugin } from '@graphiql/react';
import { Editor as MonacoEditor } from '@monaco-editor/react';
import { InfoCircledIcon, Pencil1Icon, TriangleRightIcon } from '@radix-ui/react-icons';

export const preflightScriptPlugin: GraphiQLPlugin = {
  icon: () => (
    <svg
      viewBox="0 0 256 256"
      stroke="currentColor"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    >
      <path d="M136 160h40" />
      <path d="m80 96 40 32-40 32" />
      <rect width="192" height="160" x="32" y="48" rx="8.5" />
    </svg>
  ),
  title: 'Preflight script',
  content: function Content() {
    const [value, setValue] = useState("console.log('Hello world')");
    const [showModal, toggleShowModal] = useToggle(true);
    const [checked, setChecked] = useState(false);

    return (
      <>
        <PreflightScriptModal
          isOpen={showModal}
          toggle={toggleShowModal}
          value={value}
          onChange={setValue}
        />
        <div className="graphiql-doc-explorer-title flex items-center justify-between gap-4">
          Preflight Script
          <Button
            variant="orangeLink"
            size="icon-sm"
            className="size-auto gap-1"
            onClick={toggleShowModal}
          >
            <Pencil1Icon className="shrink-0" />
            Edit
          </Button>
        </div>
        <p className="text-sm text-gray-400">
          This script is run before each operation submitted, e.g. for automated authentication.
        </p>

        <div className="flex items-center gap-2 text-sm">
          <Switch checked={checked} onCheckedChange={setChecked} className="my-4" />
          <span className="w-6">{checked ? 'ON' : 'OFF'}</span>
        </div>

        {checked && (
          <MonacoEditor
            height="auto"
            className="h-32 *:rounded-md *:bg-[hsla(var(--color-neutral),var(--alpha-background-light))] *:py-3 *:opacity-70"
            defaultLanguage="javascript"
            value={value}
            onChange={(newValue = '') => setValue(newValue)}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              lineNumbers: 'off',
              readOnly: true,
            }}
          />
        )}
      </>
    );
  },
};

function PreflightScriptModal({
  isOpen,
  toggle,
  value,
  onChange,
}: {
  isOpen: boolean;
  toggle: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={toggle}>
      <DialogContent className="w-11/12 !max-w-[unset] xl:w-4/5">
        <DialogHeader>
          <DialogTitle>Edit your Preflight Script</DialogTitle>
          <DialogDescription>
            This script will run in each user's browser and be stored in plain text on our servers.
            Don't share any secrets here 🤫.
            <br />
            All team members can view the script and toggle it off when they need to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid h-[60vh] grid-cols-2 [&_section]:grow">
          <div className="flex flex-col">
            <div className="flex justify-between p-2">
              <div className="flex gap-2">
                Script Editor
                <Badge className="text-xs" variant="gray">
                  JavaScript
                </Badge>
              </div>
              <Button variant="orangeLink" size="icon-sm" className="size-auto">
                <TriangleRightIcon className="shrink-0" /> Run Script
              </Button>
            </div>
            <MonacoEditor
              className="*:bg-[rgba(183,194,215,.07)] *:py-3"
              defaultLanguage="javascript"
              value={value}
              onChange={onChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
              }}
            />
          </div>
          <div className="flex flex-col">
            <div className="p-2">Console output</div>
            <MonacoEditor
              className="*:bg-[rgba(183,194,215,.07)] *:py-3"
              defaultLanguage="javascript"
              // value={value}
              // onChange={(newValue = '') => setValue(newValue)}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
              }}
            />
            <div className="flex gap-2 p-2">
              Environment Variables
              <Badge className="text-xs" variant="gray">
                JSON
              </Badge>
            </div>
            <MonacoEditor
              className="*:bg-[rgba(183,194,215,.07)] *:py-3"
              defaultLanguage="json"
              // value={value}
              // onChange={(newValue = '') => setValue(newValue)}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
              }}
            />
          </div>
        </div>
        <DialogFooter className="items-center">
          <p className="me-5 flex items-center gap-2 text-sm">
            <InfoCircledIcon />
            Changes made to this Preflight Script will apply to all users on your team using this
            variant.
          </p>
          <Button type="button">Close</Button>
          <Button type="button" variant="primary">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
