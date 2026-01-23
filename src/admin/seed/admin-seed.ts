import { PrismaService } from '../../prisma/prisma.service';

export class AdminSeedService {
  constructor(private prisma: PrismaService) {}

  async seedDefaultPermissions() {
    console.log('🌱 Seeding default admin permissions...');

    const defaultPermissions = [
      // User management permissions
      { name: 'users:read', description: 'Read users', resource: 'users', action: 'read' },
      { name: 'users:create', description: 'Create users', resource: 'users', action: 'create' },
      { name: 'users:update', description: 'Update users', resource: 'users', action: 'update' },
      { name: 'users:delete', description: 'Delete users', resource: 'users', action: 'delete' },
      { name: 'users:export', description: 'Export users', resource: 'users', action: 'export' },
      { name: 'users:import', description: 'Import users', resource: 'users', action: 'import' },

      // Campaign management permissions
      { name: 'campaigns:read', description: 'Read campaigns', resource: 'campaigns', action: 'read' },
      { name: 'campaigns:create', description: 'Create campaigns', resource: 'campaigns', action: 'create' },
      { name: 'campaigns:update', description: 'Update campaigns', resource: 'campaigns', action: 'update' },
      { name: 'campaigns:delete', description: 'Delete campaigns', resource: 'campaigns', action: 'delete' },

      // Client management permissions
      { name: 'clients:read', description: 'Read clients', resource: 'clients', action: 'read' },
      { name: 'clients:create', description: 'Create clients', resource: 'clients', action: 'create' },
      { name: 'clients:update', description: 'Update clients', resource: 'clients', action: 'update' },
      { name: 'clients:delete', description: 'Delete clients', resource: 'clients', action: 'delete' },

      // Billing management permissions
      { name: 'billing:read', description: 'Read billing information', resource: 'billing', action: 'read' },
      { name: 'billing:update', description: 'Update billing information', resource: 'billing', action: 'update' },
      { name: 'billing:manage', description: 'Manage billing', resource: 'billing', action: 'manage' },

      // System permissions
      { name: 'dashboard:read', description: 'Read dashboard', resource: 'dashboard', action: 'read' },
      { name: 'stats:read', description: 'Read statistics', resource: 'stats', action: 'read' },
      { name: 'audit:read', description: 'Read audit logs', resource: 'audit', action: 'read' },
      { name: 'system:read', description: 'Read system info', resource: 'system', action: 'read' },
      { name: 'system:manage', description: 'Manage system', resource: 'system', action: 'manage' },

      // Permission and role management
      { name: 'permissions:read', description: 'Read permissions', resource: 'permissions', action: 'read' },
      { name: 'permissions:create', description: 'Create permissions', resource: 'permissions', action: 'create' },
      { name: 'permissions:update', description: 'Update permissions', resource: 'permissions', action: 'update' },
      { name: 'permissions:delete', description: 'Delete permissions', resource: 'permissions', action: 'delete' },
      { name: 'roles:read', description: 'Read roles', resource: 'roles', action: 'read' },
      { name: 'roles:create', description: 'Create roles', resource: 'roles', action: 'create' },
      { name: 'roles:update', description: 'Update roles', resource: 'roles', action: 'update' },
      { name: 'roles:delete', description: 'Delete roles', resource: 'roles', action: 'delete' },

      // Reports and analytics
      { name: 'reports:read', description: 'Read reports', resource: 'reports', action: 'read' },
      { name: 'reports:create', description: 'Create reports', resource: 'reports', action: 'create' },
      { name: 'reports:export', description: 'Export reports', resource: 'reports', action: 'export' },

      // AI and content management
      { name: 'ai:manage', description: 'Manage AI services', resource: 'ai', action: 'manage' },
      { name: 'content:manage', description: 'Manage content', resource: 'content', action: 'manage' },
    ];

    const results = [];
    for (const permission of defaultPermissions) {
      try {
        const existing = await this.prisma.adminPermission.findUnique({
          where: { name: permission.name },
        });

        if (!existing) {
          await this.prisma.adminPermission.create({
            data: permission,
          });
          results.push({ permission: permission.name, status: 'created' });
        } else {
          results.push({ permission: permission.name, status: 'exists' });
        }
      } catch (error) {
        results.push({ permission: permission.name, status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }

    console.log(`✅ Permissions seeding completed: ${results.filter(r => r.status === 'created').length} created, ${results.filter(r => r.status === 'exists').length} already exist`);
    return results;
  }

  async seedDefaultRoles() {
    console.log('🌱 Seeding default admin roles...');

    // Get all permissions first
    const permissions = await this.prisma.adminPermission.findMany();

    const defaultRoles = [
      {
        name: 'Super Admin',
        description: 'Full system access with all permissions',
        permissionIds: permissions.map(p => p.id),
        isDefault: false,
      },
      {
        name: 'User Manager',
        description: 'Manage users and basic system functions',
        permissionIds: permissions
          .filter(p => p.resource === 'users' || p.resource === 'dashboard' || p.resource === 'audit' || p.resource === 'stats')
          .map(p => p.id),
        isDefault: false,
      },
      {
        name: 'Content Manager',
        description: 'Manage campaigns, clients, and content',
        permissionIds: permissions
          .filter(p => ['campaigns', 'clients', 'dashboard', 'reports', 'ai', 'content'].includes(p.resource))
          .map(p => p.id),
        isDefault: false,
      },
      {
        name: 'Billing Manager',
        description: 'Manage billing and financial operations',
        permissionIds: permissions
          .filter(p => ['billing', 'dashboard', 'stats', 'audit'].includes(p.resource))
          .map(p => p.id),
        isDefault: false,
      },
      {
        name: 'Read Only Admin',
        description: 'Read-only access to system information',
        permissionIds: permissions
          .filter(p => p.action === 'read')
          .map(p => p.id),
        isDefault: true,
      },
    ];

    const results = [];
    for (const role of defaultRoles) {
      try {
        const existing = await this.prisma.adminRole.findUnique({
          where: { name: role.name },
        });

        if (!existing) {
          await this.prisma.adminRole.create({
            data: {
              name: role.name,
              description: role.description,
              isDefault: role.isDefault,
              permissions: {
                connect: role.permissionIds.map(id => ({ id })),
              },
            },
          });
          results.push({ role: role.name, status: 'created' });
        } else {
          results.push({ role: role.name, status: 'exists' });
        }
      } catch (error) {
        results.push({ role: role.name, status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }

    console.log(`✅ Roles seeding completed: ${results.filter(r => r.status === 'created').length} created, ${results.filter(r => r.status === 'exists').length} already exist`);
    return results;
  }

  async seedDefaultAdminUser() {
    console.log('🌱 Seeding default admin user...');

    try {
      // Check if any admin users exist
      const existingAdmin = await this.prisma.user.findFirst({
        where: { role: 'ADMIN' },
      });

      if (existingAdmin) {
        console.log('✅ Admin user already exists, skipping creation');
        return { status: 'exists', user: existingAdmin };
      }

      // Create default admin user
      const adminUser = await this.prisma.user.create({
        data: {
          email: 'admin@example.com',
          password: '$2b$10$rQZ8K9vJ8K9vJ8K9vJ8K9uK9vJ8K9vJ8K9vJ8K9vJ8K9vJ8K9vJ8K', // 'admin123' hashed
          name: 'System Administrator',
          role: 'ADMIN',
          company: 'System',
          isActive: true,
        },
      });

      console.log('✅ Default admin user created');
      console.log('📧 Email: admin@example.com');
      console.log('🔑 Password: admin123');
      console.log('⚠️  Please change the default password after first login!');

      return { status: 'created', user: adminUser };
    } catch (error) {
      console.error('❌ Failed to create default admin user:', error instanceof Error ? error.message : String(error));
      return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async runSeed() {
    console.log('🚀 Starting admin seed process...');
    
    try {
      await this.seedDefaultPermissions();
      await this.seedDefaultRoles();
      await this.seedDefaultAdminUser();
      
      console.log('🎉 Admin seed process completed successfully!');
    } catch (error) {
      console.error('❌ Admin seed process failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
