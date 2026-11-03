export class ImageInputError extends Error {
  constructor(
    public code:
      | 'type'
      | 'tiff'
      | 'corrupt'
      | 'batch'
      | 'empty'
      | 'processing'
      | 'output'
      | 'resource'
      | 'encoding'
      | 'pageSize',
  ) {
    super(code)
  }
}
