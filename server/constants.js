'use strict';

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const VALID_REVIEW_STATUS = ['pending', 'published', 'hidden'];

const POINTS_PER_COVER = 100;
const POINTS_UNIT = 100;
const POINTS_RATE = 0.5;

module.exports = {
  VALID_STATUS,
  VALID_OCCASIONS,
  VALID_TABLES,
  VALID_REVIEW_STATUS,
  POINTS_PER_COVER,
  POINTS_UNIT,
  POINTS_RATE
};
