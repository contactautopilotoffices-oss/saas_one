import { useState, useEffect } from 'react';

interface MasterAdminCheck {
    isMasterAdmin: boolean;
    isLoading: boolean;
}

/**
 * Hook to verify if current user is a Master Admin
 * Uses the /api/admin/verify endpoint instead of hardcoded emails
 */
export function useMasterAdminCheck(): MasterAdminCheck {
    const [isMasterAdmin, setIsMasterAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkMasterAdmin = async () => {
            try {
                const response = await fetch('/api/admin/verify');
                const data = await response.json();
                setIsMasterAdmin(data.isMasterAdmin === true);
            } catch (error) {
                console.error('Error checking master admin status:', error);
                setIsMasterAdmin(false);
            } finally {
                setIsLoading(false);
            }
        };

        checkMasterAdmin();
    }, []);

    return { isMasterAdmin, isLoading };
}
