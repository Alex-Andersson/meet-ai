"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
// import { authClient } from "@/lib/auth-client"
import { ErrorState } from "@/components/error-state"
import { LoadingState } from "@/components/loading-state"
import { PricingCard } from "../components/pricing-card"

export const UpgradeView = () => {
    const trpc = useTRPC()
    const { data: products } = useSuspenseQuery(
        trpc.premium.getProducts.queryOptions()
    );

    const { data: currentSubscription } = useSuspenseQuery(
        trpc.premium.getCurrentSubscription.queryOptions()
    );

    return (
        <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-10">
            <div className="mt-4 flex-1 flex flex-col gap-y-10 items-center">
                <h5 className="font-medium text-2xl md:text-3xl">
                    You are on the {" "}
                    <span className="font-semibold text-primary">
                        Free
                    </span>{" "}
                    plan
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="col-span-full text-center py-8">
                        <h3 className="text-lg font-medium text-muted-foreground">
                            Premium features coming soon!
                        </h3>
                        <p className="text-sm text-muted-foreground mt-2">
                            We&apos;re working on exciting premium features. Stay tuned!
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
};

export const UpgradeViewLoading = () => {
    return (
        <LoadingState title="Loading" description="Please wait while we load the upgrade options." />
    );
};

export const UpgradeViewError = () => {
    return (
        <ErrorState title="Error" description="There was an error loading the upgrade options. Please try again later." />
    );
};