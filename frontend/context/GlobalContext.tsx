'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Organization, Property, Building, Floor, Space, SystemContext } from '@/frontend/types/core';
import { MOCK_ORG, MOCK_PROPERTIES, getBuildings, getFloors } from '@/backend/lib/mock-data';

interface GlobalContextType {
    context: SystemContext;
    setContext: (ctx: Partial<SystemContext>) => void;
    // Navigation helpers
    selectProperty: (propertyId: string) => void;
    selectBuilding: (buildingId: string) => void;
    selectFloor: (floorId: string) => void;
    navigateUp: () => void;
    isLoading: boolean;
}

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
    const [context, setContextState] = useState<SystemContext>({
        organization: MOCK_ORG, // Default to the mock org
    });
    const [isLoading, setIsLoading] = useState(false);

    const setContext = (updates: Partial<SystemContext>) => {
        setContextState(prev => ({ ...prev, ...updates }));
    };

    const selectProperty = (propertyId: string) => {
        setIsLoading(true);
        // Simulate API call
        setTimeout(() => {
            const property = MOCK_PROPERTIES.find(p => p.id === propertyId);
            if (property) {
                setContextState(prev => ({
                    ...prev,
                    property,
                    building: undefined, // Reset children
                    floor: undefined,
                    space: undefined
                }));
            }
            setIsLoading(false);
        }, 100);
    };

    const selectBuilding = (buildingId: string) => {
        if (!context.property) return;
        setIsLoading(true);
        setTimeout(() => {
            const buildings = getBuildings(context.property!.id);
            const building = buildings.find(b => b.id === buildingId);
            if (building) {
                setContextState(prev => ({
                    ...prev,
                    building,
                    floor: undefined,
                    space: undefined
                }));
            }
            setIsLoading(false);
        }, 100);
    };

    const selectFloor = (floorId: string) => {
        if (!context.building) return;
        setIsLoading(true);
        setTimeout(() => {
            const floors = getFloors(context.building!.id);
            const floor = floors.find(f => f.id === floorId);
            if (floor) {
                setContextState(prev => ({ ...prev, floor, space: undefined }));
            }
            setIsLoading(false);
        }, 100);
    };

    const navigateUp = () => {
        if (context.space) {
            setContextState(prev => ({ ...prev, space: undefined }));
        } else if (context.floor) {
            setContextState(prev => ({ ...prev, floor: undefined }));
        } else if (context.building) {
            setContextState(prev => ({ ...prev, building: undefined }));
        } else if (context.property) {
            setContextState(prev => ({ ...prev, property: undefined }));
        }
    };

    return (
        <GlobalContext.Provider value={{
            context,
            setContext,
            selectProperty,
            selectBuilding,
            selectFloor,
            navigateUp,
            isLoading
        }}>
            {children}
        </GlobalContext.Provider>
    );
}

export const useGlobalContext = () => {
    const context = useContext(GlobalContext);
    if (context === undefined) {
        throw new Error('useGlobalContext must be used within a GlobalProvider');
    }
    return context;
};
