import React from 'react';
import { render } from '@testing-library/react-native';
import Customers from '../customers';
import { describe, it, expect } from '@jest/globals';

describe('Customers Screen', () => {
  it('renders correctly', () => {
    const { getByText } = render(<Customers />) as any;
    expect(getByText('Customers')).toBeTruthy();
    expect(getByText('No customers found locally')).toBeTruthy();
  });
});
