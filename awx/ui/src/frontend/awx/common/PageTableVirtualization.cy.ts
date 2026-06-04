import { getVirtualizedRange } from '../../../framework/PageTable/PageTable';

describe('PageTable virtualization', () => {
  it('returns a full range when the viewport has not been measured yet', () => {
    expect(
      getVirtualizedRange({
        rowCount: 100,
        rowHeight: 56,
        viewportHeight: 0,
        scrollTop: 0,
        overscan: 6,
      })
    ).to.deep.equal({
      startIndex: 0,
      endIndex: 100,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it('windows rows with overscan and spacer heights', () => {
    expect(
      getVirtualizedRange({
        rowCount: 200,
        rowHeight: 44,
        viewportHeight: 440,
        scrollTop: 880,
        overscan: 2,
      })
    ).to.deep.equal({
      startIndex: 18,
      endIndex: 32,
      topSpacerHeight: 792,
      bottomSpacerHeight: 7392,
    });
  });

  it('clamps the window at the end of the page', () => {
    expect(
      getVirtualizedRange({
        rowCount: 50,
        rowHeight: 50,
        viewportHeight: 300,
        scrollTop: 2400,
        overscan: 3,
      })
    ).to.deep.equal({
      startIndex: 45,
      endIndex: 50,
      topSpacerHeight: 2250,
      bottomSpacerHeight: 0,
    });
  });
});
