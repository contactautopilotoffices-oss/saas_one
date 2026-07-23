import { User, RoleKey, RoleLevel } from '@/frontend/types/rbac';

const MOCK_USERS: User[] = [
    {
        id: 'u1',
        full_name: 'Amol Lokhande',
        email: 'amol@email.com',
        role_key: 'mst',
        role_level: 1,
        property_id: 'prop-1',
        status: 'active',
        created_at: Date.now()
    },
    {
        id: 'u2',
        full_name: 'Sarah Chen',
        email: 'sarah@email.com',
        role_key: 'property_admin',
        role_level: 3,
        property_id: 'prop-1',
        status: 'active',
        created_at: Date.now()
    },
    {
        id: 'u3',
        full_name: 'Mike Ross',
        email: 'mike@email.com',
        role_key: 'tenant_user',
        role_level: 0,
        property_id: 'prop-1',
        status: 'active',
        created_at: Date.now()
    }
];

export const userService = {
    getUsers: async (propertyId: string): Promise<User[]> => {
        await new Promise(resolve => setTimeout(resolve, 400));
        return MOCK_USERS.filter(u => u.property_id === propertyId);
    },

    createUser: async (user: Omit<User, 'id' | 'created_at'>): Promise<User> => {
        await new Promise(resolve => setTimeout(resolve, 600));
        const newUser: User = {
            ...user,
            id: `u-${Math.random().toString(36).substr(2, 9)}`,
            created_at: Date.now()
        };
        MOCK_USERS.push(newUser);
        return newUser;
    },

    updateRole: async (userId: string, roleKey: RoleKey, roleLevel: RoleLevel): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 300));
        const user = MOCK_USERS.find(u => u.id === userId);
        if (user) {
            user.role_key = roleKey;
            user.role_level = roleLevel;
        }
    },

    updateStatus: async (userId: string, status: 'active' | 'suspended'): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 300));
        const user = MOCK_USERS.find(u => u.id === userId);
        if (user) {
            user.status = status;
        }
    }
};
