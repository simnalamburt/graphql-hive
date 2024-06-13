import { ReactElement } from 'react';
import cookies from 'js-cookie';
import { FaUsersSlash } from 'react-icons/fa';
import { useMutation } from 'urql';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LAST_VISITED_ORG_KEY } from '@/constants';
import { graphql } from '@/gql';
import { useNotifications } from '@/lib/hooks/use-notifications';

const LeaveOrganizationModal_LeaveOrganizationMutation = graphql(`
  mutation LeaveOrganizationModal_LeaveOrganizationMutation($input: OrganizationSelectorInput!) {
    leaveOrganization(input: $input) {
      ok {
        organizationId
      }
      error {
        message
      }
    }
  }
`);

export function LeaveOrganizationModal({
  isOpen,
  toggleModalOpen,
  organizationId,
  organizationName,
}: {
  isOpen: boolean;
  toggleModalOpen: () => void;
  organizationId: string;
  organizationName: string;
}): ReactElement {
  const [, mutate] = useMutation(LeaveOrganizationModal_LeaveOrganizationMutation);
  const notify = useNotifications();

  return (
    <Dialog open={isOpen} onOpenChange={toggleModalOpen}>
      <DialogContent className="flex flex-col items-center gap-5">
        <DialogHeader>
          <FaUsersSlash className="h-16 w-auto text-red-500 opacity-70" />
          <DialogTitle>Leave {organizationName}?</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Are you sure you want to leave this organization? You will lose access to{' '}
          <span className="font-semibold">{organizationName}</span>. This action is irreversible!
        </DialogDescription>
        <DialogFooter className="flex w-full gap-2">
          <Button type="button" variant="ghost" onClick={toggleModalOpen}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              const result = await mutate({
                input: {
                  organization: organizationId,
                },
              });

              if (result.error) {
                notify("Couldn't leave organization. Please try again.", 'error');
              }

              if (result.data?.leaveOrganization.error) {
                notify(result.data.leaveOrganization.error.message, 'error');
              }

              if (result.data?.leaveOrganization.ok) {
                toggleModalOpen();
                cookies.remove(LAST_VISITED_ORG_KEY);
                window.location.href = '/';
              }
            }}
          >
            Leave organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
