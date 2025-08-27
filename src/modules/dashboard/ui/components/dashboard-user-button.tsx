"use client";

import { authClient } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { ChevronDownIcon, CreditCardIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";

export const DashboardUserButton = () => {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { data, isPending } = authClient.useSession();

  const onLogout = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in");
        },
      },
    });
  };

  if (isPending || !data?.user) {
    return null;
  }

  const userAvatar = data.user.image ? (
    <Avatar>
      <AvatarImage
        src={data.user.image}
        alt={data.user.name || "User Avatar"}
      />
    </Avatar>
  ) : (
    <GeneratedAvatar
      seed={data.user.name}
      className="size-9 mr-3"
      variant="initials"
    />
  );

  if (isMobile) {
    return (
      <Drawer>
        <DrawerTrigger className="rounded-lg border border-border/10 p-3 w-full flex items-center justify-between bg-white/5 hover:bg-white/10 overflow-hidden gap-x-2">
          {userAvatar}
          <div className="flex flex-col gap-0.5 text-left overflow-hidden flex-1 min-w-0">
            <p>{data.user.name || "User"}</p>
            <p className="text-sm text-muted-foreground">
              {data.user.email || "user@example.com"}
            </p>
          </div>
          <ChevronDownIcon className="size-4 shrink-0" />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{data.user.name}</DrawerTitle>
            <DrawerDescription>{data.user.email}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            {/* Billing temporarily disabled for production */}
            {/* <Button variant="outline" onClick={() => authClient.customer.portal()} className="w-full">
              <CreditCardIcon className="size-4 mr-2" />
              Billing
            </Button> */}
            <Button variant="destructive" onClick={onLogout} className="w-full">
              <LogOutIcon className="size-4 mr-2" />
              Logout
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-lg border border-border/10 p-3 w-full flex
         items-center justify-between bg-white/5 hover:bg-white/10 overflow-hidden gap-x-2"
      >
        {userAvatar}
        <div className="flex flex-col gap-0.5 text-left overflow-hidden flex-1 min-w-0">
          <p>{data.user.name || "User"}</p>
          <p className="text-sm text-muted-foreground">
            {data.user.email || "user@example.com"}
          </p>
        </div>
        <ChevronDownIcon className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" className="w-72">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-1">
            <span className="font-medium truncate">{data.user.name}</span>
            <span className="text-sm font-normal text-muted-foreground truncate">
              {data.user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Billing temporarily disabled for production */}
        {/* <DropdownMenuItem onClick={() => authClient.customer.portal()} className="cursor-pointer flex items-center justify-between">
          Billing
          <CreditCardIcon className="size-4" />
        </DropdownMenuItem> */}
        <DropdownMenuItem
          onClick={onLogout}
          className="cursor-pointer flex items-center justify-between"
        >
          Logout
          <LogOutIcon className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
