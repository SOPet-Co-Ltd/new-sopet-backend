import { Reflector } from '@nestjs/core';
import { EmailCmsResolver } from './email-cms.resolver';
import { ROLES_KEY } from '../../common/decorators';

describe('EmailCmsResolver — authz', () => {
  it('requires the admin role on the whole resolver (light authz check)', () => {
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(ROLES_KEY, EmailCmsResolver);
    expect(roles).toEqual(['admin']);
  });
});
