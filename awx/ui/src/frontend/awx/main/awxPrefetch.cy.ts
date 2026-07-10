import { setAwxApiPath } from '../common/api/awx-utils';
import { getAwxPrefetchUrls } from './awxPrefetch';

describe('awxPrefetch', () => {
  afterEach(() => {
    setAwxApiPath('/api/v2');
  });

  it('prefetches core navigation resource-count endpoints', () => {
    const urls = getAwxPrefetchUrls();

    expect(urls).to.include('/api/v2/dashboard/');
    expect(urls).to.include('/api/v2/dashboard/graphs/jobs/?job_type=all&period=month');
    expect(urls).to.include('/api/v2/hosts/?page_size=1');
    expect(urls).to.include('/api/v2/inventories/?page_size=1');
    expect(urls).to.include('/api/v2/job_templates/?page_size=1');
    expect(urls).to.include('/api/v2/workflow_job_templates/?page_size=1');
    expect(urls).to.include('/api/v2/projects/?page_size=1');
    expect(urls).to.include('/api/v2/schedules/?page_size=1');
    expect(urls).to.include('/api/v2/catalog_items/?page_size=1');
    expect(new Set(urls).size).to.equal(urls.length);
  });

  it('adds admin-only navigation endpoints only when requested', () => {
    const coreUrls = getAwxPrefetchUrls();
    const adminUrls = getAwxPrefetchUrls({ includeAdminResources: true });

    expect(coreUrls).not.to.include('/api/v2/catalog_cloud/connections/?page_size=1');
    expect(adminUrls).to.include('/api/v2/catalog_cloud/connections/?page_size=1');
    expect(adminUrls).to.include('/api/v2/notification_templates/?page_size=1');
    expect(adminUrls.length).to.be.greaterThan(coreUrls.length);
  });

  it('uses the configured Capstan API path', () => {
    setAwxApiPath('/gateway/api/v2');

    expect(getAwxPrefetchUrls()).to.include('/gateway/api/v2/hosts/?page_size=1');
  });
});
