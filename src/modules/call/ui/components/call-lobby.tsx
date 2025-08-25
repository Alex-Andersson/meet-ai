import { LogInIcon } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { generatedAvatarUri } from "@/lib/avatar";
import {
  DefaultVideoPlaceholder,
  StreamVideoParticipant,
  ToggleAudioPreviewButton,
  ToggleVideoPreviewButton,
  useCallStateHooks,
  VideoPreview
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";

interface Props {
  onJoin: () => void;
}

const DisableVideoPreview = () => {
    const { data } = authClient.useSession();

    return (
        <DefaultVideoPlaceholder 
            participant={
                {
                    name: data?.user.name || "",
                    image:
                        data?.user.image ??
                        generatedAvatarUri({ 
                            seed: data?.user.name ?? "",
                            variant:"initials"
                        }),
                } as StreamVideoParticipant
            }
        />
    )
}

const AllowBrowserPermissions = () => {
    return (
        <p className="text-sm">
            Please allow access to your camera and microphone to join the call.
        </p>
    )
}

export const CallLobby = ({ onJoin }: Props) => {
    const { useCameraState, useMicrophoneState } = useCallStateHooks();

    const { hasBrowserPermission: hasMicPermission } = useMicrophoneState();
    const { hasBrowserPermission: hasCamPermission } = useCameraState();

    const hasBrowserMediaPermissions = hasMicPermission && hasCamPermission;

    return (
        <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar">
            <div className="py-4 px-8 flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center justify-center gap-y-6 bg-background rounded-xl p-10 shadow-sm">
                    <div className="flex flex-col gap-y-2 text-center">
                        <h6 className="text-lg font-medium">Ready to join?</h6>
                        <p className="text-sm">Set up call before joining</p>
                    </div>
                    <VideoPreview 
                        DisabledVideoPreview={
                            hasBrowserMediaPermissions
                                ? DisableVideoPreview
                                : AllowBrowserPermissions
                        }
                    />
                    <div className="flex gap-x-2">
                        <ToggleAudioPreviewButton />
                        <ToggleVideoPreviewButton />
                    </div>
                    <div className="flex gap-x-2 justify-between w-full">
                        <Button asChild variant="ghost">
                            <Link href="/meetings">
                                Cancel
                            </Link>
                        </Button>
                        <Button
                            onClick={onJoin}
                        >
                            <LogInIcon />
                            Join Call
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}